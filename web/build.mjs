import {build} from 'esbuild';
import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('web-dist/assets', {recursive: true});
await build({entryPoints: ['web/app.jsx'], outfile: 'web-dist/assets/app.js', bundle: true, minify: true, platform: 'browser', target: 'es2022', define: {'process.env.NODE_ENV': '"production"'}, loader: {'.js': 'jsx'}});
await copyFile('web/index.html', 'web-dist/index.html');
