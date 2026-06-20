#!/bin/bash

# Color styles for logs
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "==============================================="
echo "           Stopping DevAssist Engine           "
echo "==============================================="

# Stop and remove containers, networks, and volumes created by compose up
docker compose down

echo -e "${RED}✔ All DevAssist containers stopped and cleaned up.${NC}"
