/**
 * Unit tests for the changelog action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mock data for testing
const mockPRs = [
  {
    title: 'Add new writer features',
    body: 'Enhanced content editing capabilities',
    number: 123,
    html_url: 'https://github.com/test/repo/pull/123',
    user: { login: 'dev1' },
    merged_at: '2024-01-15T10:00:00Z',
    labels: [{ name: 'writer' }, { name: 'feature' }]
  },
  {
    title: 'Update UI components',
    body: 'New dashboard design',
    number: 124,
    html_url: 'https://github.com/test/repo/pull/124',
    user: { login: 'dev2' },
    merged_at: '2024-01-16T10:00:00Z',
    labels: [{ name: 'ui' }, { name: 'feature' }]
  },
  {
    title: 'Old feature from last year',
    body: 'Should not be included',
    number: 100,
    html_url: 'https://github.com/test/repo/pull/100',
    user: { login: 'dev3' },
    merged_at: '2023-01-01T10:00:00Z',
    labels: [{ name: 'writer' }]
  }
]

const mockGeminiResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: '### Test Summary\n- Test feature added'
          }
        ]
      }
    }
  ]
}

const mockOctokit = {
  rest: {
    repos: {
      getLatestRelease: jest.fn()
    },
    pulls: {
      list: jest.fn()
    }
  }
}

const mockGithub = {
  getOctokit: jest.fn(() => mockOctokit),
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo'
    }
  }
}

const mockFetch = jest.fn()
const mockArtifact = {
  DefaultArtifactClient: jest.fn(() => ({
    uploadArtifact: jest.fn(() => ({ size: 1024 }))
  }))
}

const mockFs = {
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
}

// Mock modules
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => mockGithub)
jest.unstable_mockModule('node-fetch', () => ({ default: mockFetch }))
jest.unstable_mockModule('@actions/artifact', () => mockArtifact)
jest.unstable_mockModule('fs', () => mockFs)
jest.unstable_mockModule('path', () => ({
  join: jest.fn((...args) => args.join('/'))
}))

const { run } = await import('../src/main.js')

describe('Changelog Action', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default input mocks
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'github-token':
          return 'test-token'
        case 'gemini-api-key':
          return 'test-gemini-key'
        case 'grouping-labels':
          return 'writer,ui'
        case 'require-feature-label':
          return 'false'
        default:
          return ''
      }
    })

    // Mock successful API responses
    mockOctokit.rest.repos.getLatestRelease.mockResolvedValue({
      data: {
        id: 1,
        tag_name: 'v1.0.0',
        created_at: '2024-01-01T10:00:00Z'
      }
    })

    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: mockPRs
    })

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockGeminiResponse)
    })
  })

  it('Should process PRs and generate grouped summaries', async () => {
    await run()

    // Verify outputs were set
    expect(core.setOutput).toHaveBeenCalledWith(
      'release-date',
      expect.any(String)
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'release-timestamp',
      expect.any(String)
    )
    expect(core.setOutput).toHaveBeenCalledWith('has-previous-release', 'true')
    expect(core.setOutput).toHaveBeenCalledWith('previous-tag', 'v1.0.0')
    expect(core.setOutput).toHaveBeenCalledWith(
      'grouped-summaries',
      expect.any(String)
    )
    expect(core.setOutput).toHaveBeenCalledWith('label-groups', 'writer,ui')
    expect(core.setOutput).toHaveBeenCalledWith('total-prs', '2')
    expect(core.setOutput).toHaveBeenCalledWith('has-content', 'true')
  })

  it('Should handle missing required inputs', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'github-token') return ''
      return 'test-value'
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Missing required inputs')
    )
  })

  it('Should handle no previous release', async () => {
    mockOctokit.rest.repos.getLatestRelease.mockRejectedValue(
      new Error('Not found')
    )

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('has-previous-release', 'false')
    expect(core.setOutput).toHaveBeenCalledWith('previous-tag', '')
  })

  it('Should filter PRs by date and labels correctly', async () => {
    await run()

    // Should only include PRs from after the last release (2024-01-01)
    // and with the specified labels
    expect(core.setOutput).toHaveBeenCalledWith('total-prs', '2')

    // Should have both groups
    expect(core.setOutput).toHaveBeenCalledWith('label-groups', 'writer,ui')
  })

  it('Should handle Gemini API errors gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'API Error'
    })

    await run()

    // Should still complete but with error in summary
    expect(core.warning).toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'grouped-summaries',
      expect.any(String)
    )
  })

  it('Should require at least one grouping label', async () => {
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'github-token':
          return 'test-token'
        case 'gemini-api-key':
          return 'test-gemini-key'
        case 'grouping-labels':
          return ''
        default:
          return ''
      }
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Missing required inputs')
    )
  })

  it('Should create and upload artifacts', async () => {
    await run()

    expect(mockFs.mkdirSync).toHaveBeenCalledWith('./changelog-artifacts', {
      recursive: true
    })
    expect(mockFs.writeFileSync).toHaveBeenCalled()
    expect(mockArtifact.DefaultArtifactClient).toHaveBeenCalled()
  })

  it('Should handle feature label requirement', async () => {
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'github-token':
          return 'test-token'
        case 'gemini-api-key':
          return 'test-gemini-key'
        case 'grouping-labels':
          return 'writer,ui'
        case 'require-feature-label':
          return 'true'
        default:
          return ''
      }
    })

    await run()

    // Should include PRs that have both feature label and grouping labels
    expect(core.setOutput).toHaveBeenCalledWith('total-prs', '2')
  })

  it('Should handle empty PR list', async () => {
    mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] })

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('total-prs', '0')
    expect(core.setOutput).toHaveBeenCalledWith('has-content', 'false')
    expect(core.setOutput).toHaveBeenCalledWith('label-groups', '')
  })
})
