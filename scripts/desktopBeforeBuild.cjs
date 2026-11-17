// electron-builder's beforeBuild hook (see electron-builder.yml). The desktop app has no
// dependencies of its own (the web app is bundled already), so there is nothing to install or
// rebuild, and resolving false also stops electron-builder searching the repository's
// node_modules for them.
module.exports = async () => false;
