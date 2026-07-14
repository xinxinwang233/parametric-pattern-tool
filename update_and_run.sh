#!/bin/bash
set -e

SESSION=web

# Kill existing session if it exists
if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
fi

# Create a new detached session and run commands
tmux new-session -d -s "$SESSION"

tmux send-keys -t "$SESSION" 'cd parametric-pattern-tool' C-m
tmux send-keys -t "$SESSION" 'git pull' C-m
tmux send-keys -t "$SESSION" 'npm ci' C-m
tmux send-keys -t "$SESSION" 'npm run build' C-m
tmux send-keys -t "$SESSION" 'npm start' C-m

# Attach to the session
# tmux attach-session -t "$SESSION"