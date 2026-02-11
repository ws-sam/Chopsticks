#!/bin/bash
# Test Music & Voice Commands - Real-time monitoring

echo "======================================"
echo "TESTING MUSIC & VOICE COMMANDS"
echo "======================================"
echo ""

# Check all services are running
echo "1. Checking all services..."
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "main-bot|agent-runner|lavalink|postgres"
echo ""

# Check agent connections
echo "2. Checking agent connections..."
docker logs chopsticks-agent-runner --tail 20 2>&1 | grep -E "Connected to control|Agent ready"
echo ""

# Monitor logs in real-time
echo "3. READY TO TEST! Please run these commands in Discord:"
echo "   - /music play never gonna give you up"
echo "   - /voice add (select a channel)"
echo "   - /agents list"
echo ""
echo "Press ENTER when you've run the commands..."
read

# Show errors from the last minute
echo ""
echo "======================================"
echo "ERRORS FROM MAIN BOT:"
echo "======================================"
docker logs chopsticks-main-bot --since 1m 2>&1 | grep -i "error\|fail\|exception" | tail -20

echo ""
echo "======================================"
echo "RECENT COMMAND EXECUTIONS:"
echo "======================================"
docker logs chopsticks-main-bot --since 1m 2>&1 | grep -E "command:|Execution error" | tail -20

echo ""
echo "======================================"
echo "AGENT ACTIVITY:"
echo "======================================"
docker logs chopsticks-agent-runner --since 1m 2>&1 | tail -30

echo ""
echo "Test complete! Check output above for errors."
