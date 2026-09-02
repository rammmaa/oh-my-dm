# Releasing

Releases are automated; maintainers should not edit versions or tags manually.

## Flow

1. Merge Conventional Commit pull requests into `main`.
2. Release Please creates or updates a release PR containing the next version and changelog.
3. Review and merge the release PR.
4. Release Please creates a `vX.Y.Z` tag and GitHub Release.
5. `publish.yml` verifies, builds, and publishes the exact tagged version to npm with provenance.

`feat` creates a minor release, `fix` and `perf` create a patch release, and a breaking change creates a major release. Before 1.0, the Release Please configuration keeps breaking feature work within pre-1.0 versioning.

## One-time npm setup

1. Create or claim the public `oh-my-dm` package on npm.
2. In npm package settings, add a GitHub Actions trusted publisher:
   - Organization or user: `stacking-money-forever`
   - Repository: `oh-my-dm`
   - Workflow: `publish.yml`
   - Environment: `npm`
3. In GitHub repository settings, create an environment named `npm`. Optional required reviewers can protect production publishing.

The workflow uses OIDC and npm provenance, so a long-lived `NPM_TOKEN` is not stored in GitHub. If trusted publishing is unavailable, add an `NPM_TOKEN` secret and explicitly pass it as `NODE_AUTH_TOKEN`; do not commit tokens.

## Recovery

- Failed verification: fix the source through a pull request; never move an existing tag.
- GitHub Release exists but npm publish failed: fix the environment or trusted publisher and rerun the failed workflow.
- Version already exists on npm: do not overwrite it. Create a new fix commit and release.
- Compromised release: deprecate the npm version, publish a fixed version, and follow `SECURITY.md`.
