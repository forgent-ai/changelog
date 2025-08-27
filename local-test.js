/**
 * Local testing script for the changelog action
 * Run with: node local-test.js
 */

import dotenv from 'dotenv'
import { run } from './src/main.js'

// Load environment variables from .env file
dotenv.config()

// Mock the GitHub Actions context that would normally be available
if (!process.env.GITHUB_REPOSITORY_OWNER) {
  process.env.GITHUB_REPOSITORY_OWNER = 'forgent'
}
if (!process.env.GITHUB_REPOSITORY_NAME) {
  process.env.GITHUB_REPOSITORY_NAME = 'changelog'
}

console.log('🚀 Testing changelog action locally...')
console.log('Environment variables loaded:')
console.log(
  '- GitHub Token:',
  process.env['INPUT_GITHUB-TOKEN'] ? '✅ Set' : '❌ Missing'
)
console.log(
  '- Gemini API Key:',
  process.env['INPUT_GEMINI-API-KEY'] ? '✅ Set' : '❌ Missing'
)
console.log(
  '- Grouping Labels:',
  process.env['INPUT_GROUPING-LABELS'] || '❌ Missing'
)
console.log(
  '- Repository:',
  `${process.env.GITHUB_REPOSITORY_OWNER}/${process.env.GITHUB_REPOSITORY_NAME}`
)
console.log()

try {
  await run()
  console.log('✅ Action completed successfully!')
} catch (error) {
  console.error('❌ Action failed:', error.message)
  process.exit(1)
}
