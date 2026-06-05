#!/usr/bin/env node
const murphUrl = (process.env.MURPH_URL || `http://localhost:${process.env.MURPH_PORT || '5173'}`).replace(/\/+$/, '');

function usage() {
  console.log(`Usage: murph admin <command>

Commands:
  url                                Print the admin dashboard URL.

Options:
  --json                             Print machine-readable JSON.`);
}

function adminUrl() {
  const url = new URL('/admin', murphUrl);
  return url.toString();
}

async function main() {
  const command = process.argv[2] || 'help';
  try {
    if (command === 'url') {
      console.log(adminUrl());
    } else {
      usage();
      process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
