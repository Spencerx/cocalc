#!/bin/bash

echo >> ci.log
echo "`date` -- 📈  Starting local CoCalc CI." >> ci.log
echo "`date` -- 🚧  Waiting for changes in upstream..." >> ci.log
echo "You must ALSO run 'pnpm nats-server-ci' and 'pnpm database' in two other terminals."
echo "Run 'tail -F ci.log' in a terminal to monitor CI status."

while true; do
  # Fetch the latest commits from upstream
  git fetch

  # Check if local branch is behind the upstream branch
  LOCAL=$(git rev-parse HEAD)
  UPSTREAM=$(git rev-parse @{u})

  if [ "$LOCAL" != "$UPSTREAM" ]; then
    echo "`date` -- 👌 Changes detected in upstream. Pulling changes and executing commands."
    echo "`date` -- 🔨 Pulling..." >> ci.log

    git pull
    if [ $? -eq 0 ]; then
        echo "`date` -- ✔️ pulled" >> ci.log
        echo "`date` -- 🏃 Running..." >> ci.log
        ./scripts/run-ci.sh
        # cleanup -- temporary workaround -- should be part of test suite?
        pkill -f `pwd`/packages/project/node_modules/@cocalc/project/bin/cocalc-project.js
        if [ $? -eq 0 ]; then
            echo "`date` -- 🎉 **SUCCESS**" >> ci.log
        else
            echo "`date` -- 🤖 **FAIL**" >> ci.log
        fi
    else
        echo "🐛 failed to pull" >> ci.log
    fi
    echo "`date` -- 🚧  Waiting for changes in upstream..." >> ci.log
  fi

  # Wait for 30 seconds before checking again
  sleep 30
done