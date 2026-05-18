#!/bin/sh
set -e

if [ -n "${PRISMA_DB_PUSH}" ] && [ "${PRISMA_DB_PUSH}" != "0" ]; then
  echo "PRISMA_DB_PUSH is set: applying schema with prisma db push..."
  npx prisma db push
fi

exec node dist/src/main.js
