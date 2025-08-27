# AI-Powered Changelog Generator

[![GitHub Super-Linter](https://github.com/actions/typescript-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

A sophisticated GitHub Action that generates AI-powered changelogs by grouping
pull requests by labels and creating both markdown and Slack-formatted
summaries. :rocket:

Perfect for teams that want organized, contextual release notes automatically
generated from their pull request labels.

## ✨ Features

- **🏷️ Label-Based Grouping**: Organizes PRs by labels (e.g., `writer`, `ui`,
  `backend`)
- **🤖 AI-Powered Summaries**: Uses Google Gemini to generate contextual release
  notes
- **📱 Multi-Format Output**: Creates both GitHub markdown and Slack-formatted
  content
- **📦 Artifact Storage**: Saves detailed data for long-term access
- **🔄 Auto-Detection**: Automatically detects repository from workflow context
- **⚡ Smart Filtering**: Flexible PR selection based on labels and merge dates

## 🚀 Quick Start

```yaml
name: Generate Release Notes
on:
  schedule:
    - cron: '0 15 * * 5' # Every Friday at 3pm UTC
  workflow_dispatch:

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Generate Changelog
        id: changelog
        uses: forgent/changelog@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          grouping-labels: 'writer,ui,backend,api'

      - name: Use Results
        run: |
          echo "Groups found: ${{ steps.changelog.outputs.label-groups }}"
          echo "Total PRs: ${{ steps.changelog.outputs.total-prs }}"
```

## 📋 Inputs

| Input                   | Description                                    | Required | Default |
| ----------------------- | ---------------------------------------------- | -------- | ------- |
| `github-token`          | GitHub token for API access                    | ✅       | -       |
| `gemini-api-key`        | Google Gemini API key for AI summaries         | ✅       | -       |
| `grouping-labels`       | Comma-separated list of labels to group PRs by | ✅       | -       |
| `require-feature-label` | Whether PRs must have 'feature' label          | ❌       | `false` |

## 📤 Outputs

| Output                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `release-date`          | Current date in YYYY-MM-DD format             |
| `release-timestamp`     | Timestamp for release tagging                 |
| `has-previous-release`  | Boolean indicating if previous release exists |
| `previous-tag`          | Tag of previous release (if exists)           |
| `previous-release-date` | Creation date of previous release             |
| `grouped-summaries`     | JSON with grouped summaries by labels         |
| `label-groups`          | Comma-separated list of label groups found    |
| `total-prs`             | Total number of PRs processed                 |
| `has-content`           | Boolean indicating if content was found       |
| `artifact-name`         | Name of artifact containing detailed data     |

## 🎯 Output Format

The action generates structured output like this:

```json
{
  "writer": {
    "markdown": "### Writer Features\n- Enhanced content editing...",
    "slack": "*Writer Features*\n- Enhanced content editing..."
  },
  "ui": {
    "markdown": "### UI Improvements\n- New dashboard design...",
    "slack": "*UI Improvements*\n- New dashboard design..."
  }
}
```

## 📝 Usage Examples

### Basic Release Creation

```yaml
- name: Create Release
  uses: ncipollo/release-action@v1
  with:
    tag: release-${{ steps.changelog.outputs.release-timestamp }}
    name: Release ${{ steps.changelog.outputs.release-date }}
    body: |
      ${{ fromJSON(steps.changelog.outputs.grouped-summaries).writer.markdown }}

      ${{ fromJSON(steps.changelog.outputs.grouped-summaries).ui.markdown }}
```

### Slack Notifications

```yaml
- name: Send to Slack
  if: steps.changelog.outputs.has-content == 'true'
  uses: slackapi/slack-github-action@v2
  with:
    payload: |
      {
        "text": "🚀 New Release Available!",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "${{ fromJSON(steps.changelog.outputs.grouped-summaries).writer.slack }}"
            }
          }
        ]
      }
```

### Conditional Group Processing

````yaml
- name: Process Each Group
  run: |
    groups="${{ steps.changelog.outputs.label-groups }}"
    IFS=',' read -ra GROUP_ARRAY <<< "$groups"

    for group in "${GROUP_ARRAY[@]}"; do
      echo "Processing $group group..."
      summary=$(echo '${{ steps.changelog.outputs.grouped-summaries }}' | jq -r ".$group.markdown")
      echo "$summary" > "${group}-release-notes.md"
    done

## 🛠️ Development

### Local Testing

1. **Install dependencies**
   ```bash
   npm install
````

2. **Create test environment file**

   ```bash
   cp env.example .env
   # Edit .env with your test values
   ```

3. **Run locally**

   ```bash
   npm run local-action
   ```

   > **Note**: Make sure to set valid GitHub token and Gemini API key in your
   > `.env` file. The action will attempt to fetch real data from the repository
   > specified in the environment.

### Building

```bash
npm run package  # Build the action
npm run all      # Format, lint, test, and build
```

### Testing

```bash
npm test         # Run tests
npm run coverage # Generate coverage report
```

## 🔑 Setup Requirements

### Google Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key
3. Add it to your repository secrets as `GEMINI_API_KEY`

### GitHub Token

The action automatically uses `${{ secrets.GITHUB_TOKEN }}` which has the
necessary permissions to read PRs and releases.

## 📦 Versioning

To use a specific version of this action:

```yaml
uses: forgent/changelog@v2.0.0  # Specific version
uses: forgent/changelog@v2      # Major version
uses: forgent/changelog@main    # Latest (not recommended for production)
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `npm run all`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.

## 🔧 Troubleshooting

### Common Issues

**No PRs found**: Check that your PRs have the correct labels and are merged
within the time range.

**API Rate Limits**: The action respects GitHub API rate limits. For large
repositories, consider running less frequently.

**Gemini API Errors**: Ensure your API key is valid and has sufficient quota.

### Debug Mode

Enable debug logging by setting the `ACTIONS_STEP_DEBUG` secret to `true` in
your repository.

## 📚 Examples

Check out the [examples](./examples/) directory for complete workflow examples
and advanced usage patterns.
