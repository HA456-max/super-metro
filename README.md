# supermetro

A browser-based metro management game built with TypeScript and Vite.

## Play online

After the GitHub Pages workflow completes, the game is available at:

https://ha456-max.github.io/super-metro/

## Deployment

Every push to `main` automatically builds and deploys the game to GitHub Pages through [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

The Vite base path is configured in [`vite.config.ts`](vite.config.ts) so assets work under the repository URL.

To enable the first deployment, open Settings → Pages in the repository and set Source to GitHub Actions. Then push to `main` or run the workflow manually from the Actions tab.

## Local development

```bash
npm install
npm run dev
