const {execSync} = require("child_process");
const {cpSync, copyFileSync} = require("fs");
const {join} = require("path");
const {cwd} = require("process");

/** The root of the domino repository. */
const repositoryRoot = cwd();
/** The root of the domino-builds submodule in the domino repository. */
const buildsRepoRoot = join(repositoryRoot, 'builds')

// Remove all of the files from the builds repo.
execSync('git rm -r * --ignore-unmatch --force', {cwd: buildsRepoRoot});

// Copy all of the npm package files into the builds repo.
cpSync(join(repositoryRoot, 'lib'), join(buildsRepoRoot, 'lib'), {recursive: true});
copyFileSync(join(repositoryRoot, 'package.json'), join(buildsRepoRoot, 'package.json'));
copyFileSync(join(repositoryRoot, 'LICENSE'), join(buildsRepoRoot, 'LICENSE'));
copyFileSync(join(repositoryRoot, 'README.md'), join(buildsRepoRoot, 'README.md'));
