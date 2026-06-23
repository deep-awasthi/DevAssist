import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Default Ollama host.
// In docker, it can be http://ollama:11434 or http://host.docker.internal:11434
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(__dirname, '..', 'workspace');

// Ensure workspace directory exists
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());

function expandHome(inputPath) {
  if (!inputPath || inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveOutputPath(outputPath, projectTitle = 'project') {
  if (outputPath && outputPath.trim()) {
    const trimmedPath = expandHome(outputPath.trim());
    return path.resolve(path.isAbsolute(trimmedPath) ? trimmedPath : path.join(WORKSPACE_DIR, trimmedPath));
  }

  const safeTitle = (projectTitle || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'project';
  return path.join(WORKSPACE_DIR, `${safeTitle}-${Date.now()}`);
}

function getSafeFilePath(projectPath, filePath) {
  const normalized = path.normalize(String(filePath || '')).replace(/^([/\\])+/, '');

  if (!normalized || normalized === '.' || normalized.split(path.sep).includes('..')) {
    throw new Error(`Unsafe generated file path rejected: ${filePath}`);
  }

  const fullFilePath = path.resolve(projectPath, normalized);
  const relativeToProject = path.relative(projectPath, fullFilePath);

  if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) {
    throw new Error(`Directory traversal attempt detected in path: ${filePath}`);
  }

  return { safeRelativePath: normalized, fullFilePath };
}

// Helper function to check Ollama availability
async function checkOllamaConnection() {
  try {
    const response = await axios.get(`${OLLAMA_HOST}/`, { timeout: 2000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

// Endpoint: Check status of Ollama server
app.get('/api/status', async (req, res) => {
  const connected = await checkOllamaConnection();
  res.json({
    connected,
    ollamaHost: OLLAMA_HOST,
    workspaceDir: WORKSPACE_DIR,
  });
});

// Endpoint: Get list of installed models
app.get('/api/models', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_HOST}/api/tags`);
    res.json({
      success: true,
      models: response.data.models || [],
    });
  } catch (error) {
    res.json({
      success: false,
      message: 'Failed to connect to Ollama server',
      error: error.message,
    });
  }
});

// Endpoint: Browse local directories for project destination selection
app.get('/api/directories', async (req, res) => {
  const requestedPath = req.query.path ? String(req.query.path) : os.homedir();
  const currentPath = path.resolve(expandHome(requestedPath));

  try {
    const stats = await fs.promises.stat(currentPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        message: 'Selected path is not a directory',
      });
    }

    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        path: path.join(currentPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      currentPath,
      parentPath: path.dirname(currentPath) === currentPath ? null : path.dirname(currentPath),
      homePath: os.homedir(),
      workspaceDir: WORKSPACE_DIR,
      directories,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: `Cannot read directory: ${currentPath}`,
      error: error.message,
    });
  }
});

// Endpoint: Pull a model with streaming progress updates (SSE)
app.get('/api/pull/:model', async (req, res) => {
  const { model } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const response = await axios.post(
      `${OLLAMA_HOST}/api/pull`,
      { name: model },
      { responseType: 'stream' }
    );

    let buffer = '';
    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep partial line

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch (e) {
            // Ignore incomplete JSON
          }
        }
      }
    });

    response.data.on('end', () => {
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch (e) {}
      }
      res.write('data: {"status":"success"}\n\n');
      res.end();
    });

    response.data.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Endpoint: Delete a model
app.post('/api/delete-model', async (req, res) => {
  const { model } = req.body;
  if (!model) {
    return res.status(400).json({ error: 'Model name is required' });
  }
  try {
    await axios.delete(`${OLLAMA_HOST}/api/delete`, { data: { name: model } });
    res.json({
      success: true,
      message: `Model '${model}' deleted successfully`,
    });
  } catch (error) {
    res.json({
      success: false,
      message: 'Failed to delete model',
      error: error.message,
    });
  }
});

// Clean up markdown block wrapping if LLM wraps code in markdown
function cleanLLMOutput(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    const firstNewLineIndex = cleaned.indexOf('\n');
    if (firstNewLineIndex !== -1) {
      cleaned = cleaned.substring(firstNewLineIndex + 1);
    } else {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
  }
  return cleaned.trim();
}

// Endpoint: Generate a project (SSE)
app.post('/api/generate', async (req, res) => {
  const { prompt, model, outputPath } = req.body;

  if (!prompt || !model) {
    return res.status(400).json({ error: 'Prompt and Model are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Check connection first
    const isConnected = await checkOllamaConnection();
    if (!isConnected) {
      throw new Error('Ollama server is not connected or reachable.');
    }

    sendEvent('status', { message: 'Planning project structure and identifying files...' });

    // Step 1: Query Ollama for file list
    const systemPrompt = `You are a professional software architect. 
You must respond with ONLY a JSON object representing the file structure.
No markdown wrapping blocks, no explanations, no text before or after the JSON.
The JSON must follow this exact format:
{
  "projectTitle": "Display Title of the Project",
  "description": "Short description of what the project does",
  "files": [
    "relative/path/to/file1.ext",
    "relative/path/to/file2.ext"
  ]
}

Ensure the files listed are complete and sufficient to make a fully working, self-contained implementation of the user's request. Avoid placeholder files or blank codes.`;

    const userPlanningPrompt = `Create a project based on the following request: "${prompt}". Provide the list of files to generate in the specified JSON format.`;

    const planResponse = await axios.post(`${OLLAMA_HOST}/api/generate`, {
      model: model,
      prompt: userPlanningPrompt,
      system: systemPrompt,
      stream: false,
      options: {
        temperature: 0.1, // low temperature for structured output
      }
    });

    let planText = planResponse.data.response.trim();
    planText = cleanLLMOutput(planText);

    // Extract JSON if model wrapped it in markdown or wrote surrounding text
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse file layout plan from model. Output was: ' + planText);
    }

    let plan;
    try {
      plan = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('Failed to parse file layout JSON. Raw text: ' + jsonMatch[0]);
    }

    if (!plan.files || !Array.isArray(plan.files) || plan.files.length === 0) {
      throw new Error('Model did not return a valid list of files to generate.');
    }

    sendEvent('plan', {
      projectTitle: plan.projectTitle || 'Generated Project',
      description: plan.description || 'No description provided',
      files: plan.files
    });

    // Decide project directory path
    const projectPath = resolveOutputPath(outputPath, plan.projectTitle);
    const projectSlug = path.basename(projectPath);

    try {
      fs.mkdirSync(projectPath, { recursive: true });
    } catch (error) {
      throw new Error(`Could not create project directory "${projectPath}": ${error.message}`);
    }

    sendEvent('status', { message: `Target project directory: ${projectPath}` });

    // Step 2: Generate contents for each file
    const generatedFiles = [];

    for (let i = 0; i < plan.files.length; i++) {
      const filePath = plan.files[i];
      sendEvent('status', { message: `Generating content for file [${i + 1}/${plan.files.length}]: ${filePath}...` });

      const { safeRelativePath, fullFilePath } = getSafeFilePath(projectPath, filePath);

      const fileDir = path.dirname(fullFilePath);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      // Prompt to write this specific file
      const fileWriterSystemPrompt = `You are a master programmer. You write code that is clean, well-commented, complete, and production-ready.
You are writing files for the project: "${plan.projectTitle}" which is: "${plan.description}".
Here is the complete planned file list for the project: ${JSON.stringify(plan.files)}.

Your task is to write the complete contents of the file: "${filePath}"

Rules:
1. Return ONLY the code/contents for this file. 
2. Do NOT wrap the output in markdown code blocks (e.g. \`\`\`javascript) unless it is a markdown file.
3. No descriptions, no comments outside the code, no introductory text like "Here is the code...".
4. If the file is a configuration (e.g., package.json, requirements.txt), write the valid config code/dependencies directly.
5. Do NOT write placeholders or incomplete functions. Fill in all logic.`;

      const fileWriterPrompt = `Write the full contents for the file: "${filePath}" based on the project prompt: "${prompt}".`;

      const fileResponse = await axios.post(`${OLLAMA_HOST}/api/generate`, {
        model: model,
        prompt: fileWriterPrompt,
        system: fileWriterSystemPrompt,
        stream: false,
        options: {
          temperature: 0.2
        }
      });

      let fileContent = fileResponse.data.response;
      fileContent = cleanLLMOutput(fileContent);

      // Write content to file
      fs.writeFileSync(fullFilePath, fileContent, 'utf8');

      generatedFiles.push({
        path: safeRelativePath,
        content: fileContent
      });

      sendEvent('file_written', {
        path: safeRelativePath,
        content: fileContent
      });
    }

    sendEvent('completed', {
      projectSlug,
      projectPath,
      filesCount: plan.files.length,
      files: generatedFiles
    });

    res.end();

  } catch (error) {
    console.error('Generation failed:', error);
    sendEvent('error', { message: error.message });
    res.end();
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Workspace directory is located at: ${WORKSPACE_DIR}`);
});
