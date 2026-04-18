export const GITHUB_ORG = 'aitavern';
export const GITHUB_REPO = 'aitavern.github.io';
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_ORG}/${GITHUB_REPO}`;

// Handle the Chief of Staff uses for repo access (review bot account).
// When this changes, also update the hardcoded copies in:
//   - .github/ISSUE_TEMPLATE/application.yml (dropdown option text)
//   - README.md (application instructions)
// Those files can't import TypeScript so they are kept in sync manually.
export const GITHUB_BOT_USERNAME = 'jinglescore';
