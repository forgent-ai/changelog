import * as core from '@actions/core'
import * as github from '@actions/github'
import * as artifact from '@actions/artifact'
import fetch from 'node-fetch'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface PR {
  title: string
  body: string
  number: number
  html_url: string
  user: string
  merged_at: string
  labels: string[]
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string
      }>
    }
  }>
}

interface GroupedSummary {
  markdown: string
  slack: string
}

interface LabelGroup {
  name: string
  prs: PR[]
  summary: GroupedSummary
}

interface GroupedOutput {
  [labelName: string]: GroupedSummary
}

interface ArtifactData {
  metadata: {
    releaseDate: string
    releaseTimestamp: string
    totalPRs: number
    groupingLabels: string[]
    generatedAt: string
  }
  groups: LabelGroup[]
}

/**
 * Generate AI summary using Gemini API
 */
async function generateAISummary(prs: PR[], geminiApiKey: string, groupName?: string): Promise<string> {
  if (prs.length === 0) {
    return 'No new changes were released in this period.'
  }

  const groupContext = groupName ? ` for ${groupName}` : ''
  const prompt = `Create a concise release summary${groupContext} for the following pull requests. Focus on user-facing improvements and new capabilities. Requirements: Use ### for main headings (minimum h3), #### for subheadings if needed. Keep formatting simple and clean. Preserve Loom video embeddings exactly as they appear in PR descriptions. Return ONLY the summary content - no introductory text, no explanations, just the release notes. Here are the PRs:\n\n${JSON.stringify(prs)}`

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      }
    )

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${geminiResponse.statusText}`)
    }

    const geminiData = await geminiResponse.json() as GeminiResponse
    return geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Failed to generate summary'
  } catch (error) {
    core.warning(`Failed to generate AI summary${groupContext}: ${error}`)
    return 'Failed to generate AI summary'
  }
}

/**
 * Convert markdown summary to Slack format
 */
async function convertToSlackFormat(markdownSummary: string, geminiApiKey: string): Promise<string> {
  if (markdownSummary === 'No new changes were released in this period.' || markdownSummary === 'Failed to generate AI summary') {
    return markdownSummary
  }

  const prompt = `Reformat the following GitHub release content for Slack using these rules: Use *text* for bold (not **text**), Use _text_ for italic, Use \`code\` for inline code, Use > for blockquotes, Do NOT use ### headers - just use *Bold Text* for section headers, For Loom videos format as: <video_url|Link Text> (Slack link format), Use emojis sparingly for key points only, Keep line breaks and spacing clean for Slack, Do NOT use markdown image syntax ![](url) - use Slack's link format instead. Make it engaging and easy to read in a Slack channel. Return ONLY the reformatted content - no introductory text, no explanations, just the reformatted release notes. Here is the GitHub release content to reformat:\n\n${markdownSummary}`

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      }
    )

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${geminiResponse.statusText}`)
    }

    const geminiData = await geminiResponse.json() as GeminiResponse
    return geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Failed to generate Slack summary'
  } catch (error) {
    core.warning(`Failed to generate Slack summary: ${error}`)
    return 'Failed to generate Slack summary'
  }
}

/**
 * Group PRs by labels
 */
function groupPRsByLabels(prs: PR[], groupingLabels: string[]): Map<string, PR[]> {
  const groups = new Map<string, PR[]>()
  
  // Initialize groups
  groupingLabels.forEach(label => {
    groups.set(label, [])
  })

  // Group PRs by labels
  prs.forEach(pr => {
    pr.labels.forEach(label => {
      if (groups.has(label)) {
        groups.get(label)!.push(pr)
      }
    })
  })

  return groups
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token')
    const geminiApiKey = core.getInput('gemini-api-key')
    const groupingLabelsInput = core.getInput('grouping-labels')
    const requireFeatureLabel = core.getInput('require-feature-label') === 'true'

    if (!githubToken || !geminiApiKey || !groupingLabelsInput) {
      throw new Error('Missing required inputs: github-token, gemini-api-key, or grouping-labels')
    }

    // Parse grouping labels
    const groupingLabels = groupingLabelsInput
      .split(',')
      .map(label => label.trim())
      .filter(label => label.length > 0)

    if (groupingLabels.length === 0) {
      throw new Error('At least one grouping label must be provided')
    }

    // Create GitHub client and get repository info from context
    const octokit = github.getOctokit(githubToken)
    const { owner, repo } = github.context.repo

    core.info('Starting changelog generation...')
    core.info(`Repository: ${owner}/${repo}`)
    core.info(`Grouping labels: ${groupingLabels.join(', ')}`)
    core.info(`Require feature label: ${requireFeatureLabel}`)

    // Step 1: Get current date
    const now = new Date()
    const releaseDate = now.toISOString().split('T')[0] // YYYY-MM-DD
    const releaseTimestamp = now.toISOString()
      .replace(/[:-]/g, '')
      .replace('T', '-')
      .split('.')[0] // YYYY-MM-DD-HHMMSS

    core.setOutput('release-date', releaseDate)
    core.setOutput('release-timestamp', releaseTimestamp)
    core.info(`Release date: ${releaseDate}, timestamp: ${releaseTimestamp}`)

    // Step 2: Check for existing tags and get previous release info
    let hasPreviousRelease = false
    let previousTag = ''
    let previousReleaseDate = ''

    try {
      const { data: latestRelease } = await octokit.rest.repos.getLatestRelease({
        owner,
        repo
      })

      if (latestRelease.id) {
        hasPreviousRelease = true
        previousTag = latestRelease.tag_name
        previousReleaseDate = latestRelease.created_at
        core.info(`Found previous release: ${previousTag} created at ${previousReleaseDate}`)
      }
    } catch (error) {
      core.info('No previous releases found. This is the first release.')
    }

    core.setOutput('has-previous-release', hasPreviousRelease.toString())
    core.setOutput('previous-tag', previousTag)
    core.setOutput('previous-release-date', previousReleaseDate)

    // Step 3: Get Feature Pull Requests
    let sinceDate: string
    if (hasPreviousRelease) {
      sinceDate = previousReleaseDate
      core.info(`Fetching feature PRs since last release: ${sinceDate}`)
    } else {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      sinceDate = sevenDaysAgo.toISOString()
      core.info(`No previous release found. Fetching feature PRs from last 7 days: ${sinceDate}`)
    }

    const { data: allPRs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 100
    })
    
    const relevantPRs: PR[] = allPRs
      .filter(pr => {
        if (pr.merged_at === null || pr.merged_at <= sinceDate) {
          return false
        }
        
        const prLabels = (pr.labels || []).map(label => label.name)
        
        // Check if PR has at least one of the grouping labels
        const hasGroupingLabel = groupingLabels.some(groupLabel => prLabels.includes(groupLabel))
        
        // If feature label is required, check for it
        if (requireFeatureLabel) {
          return prLabels.includes('feature') && hasGroupingLabel
        }
        
        // Otherwise, just need at least one grouping label
        return hasGroupingLabel
      })
      .map(pr => ({
        title: pr.title,
        body: pr.body || '',
        number: pr.number,
        html_url: pr.html_url,
        user: pr.user?.login || '',
        merged_at: pr.merged_at || '',
        labels: (pr.labels || []).map(label => label.name)
      }))

    // Step 4: Group PRs and generate summaries
    core.info(`Found ${relevantPRs.length} relevant PRs`)
    
    const prGroups = groupPRsByLabels(relevantPRs, groupingLabels)
    const groupedSummaries: GroupedOutput = {}
    const labelGroups: LabelGroup[] = []
    
    // Generate summaries for each group
    for (const [labelName, prs] of prGroups) {
      if (prs.length > 0) {
        core.info(`Generating summary for ${labelName} group (${prs.length} PRs)`)
        
        const markdownSummary = await generateAISummary(prs, geminiApiKey, labelName)
        const slackSummary = await convertToSlackFormat(markdownSummary, geminiApiKey)
        
        const groupSummary: GroupedSummary = {
          markdown: markdownSummary,
          slack: slackSummary
        }
        
        groupedSummaries[labelName] = groupSummary
        labelGroups.push({
          name: labelName,
          prs,
          summary: groupSummary
        })
      }
    }

    // Set outputs
    core.setOutput('grouped-summaries', JSON.stringify(groupedSummaries))
    core.setOutput('label-groups', labelGroups.map(g => g.name).join(','))
    core.setOutput('total-prs', relevantPRs.length.toString())
    core.setOutput('has-content', (labelGroups.length > 0).toString())

    // Step 5: Save detailed data as artifact
    const artifactData: ArtifactData = {
      metadata: {
        releaseDate,
        releaseTimestamp,
        totalPRs: relevantPRs.length,
        groupingLabels,
        generatedAt: new Date().toISOString()
      },
      groups: labelGroups
    }

    // Create artifact directory
    const artifactDir = './changelog-artifacts'
    mkdirSync(artifactDir, { recursive: true })
    
    // Write artifact data
    const artifactPath = join(artifactDir, 'grouped-changelog.json')
    writeFileSync(artifactPath, JSON.stringify(artifactData, null, 2))
    
    // Upload artifact
    const artifactClient = new artifact.DefaultArtifactClient()
    const artifactName = `changelog-${releaseTimestamp}`
    
    try {
      const uploadResult = await artifactClient.uploadArtifact(
        artifactName,
        [artifactPath],
        artifactDir
      )
      
      core.setOutput('artifact-name', artifactName)
      core.info(`Uploaded artifact: ${artifactName} (${uploadResult.size} bytes)`)
    } catch (error) {
      core.warning(`Failed to upload artifact: ${error}`)
      core.setOutput('artifact-name', '')
    }

    core.info('Changelog generation completed successfully')

  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}
