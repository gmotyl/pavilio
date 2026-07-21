export interface FileEntry {
  status: string;
  path: string;
}

export interface TreeNode {
  name: string;
  path: string;
  file?: FileEntry;
  children: TreeNode[];
}

export function buildFileTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const f of files) {
    // git status without -uall reports untracked dirs as "dir/" — a trailing
    // slash would otherwise create a nameless child node.
    const parts = f.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const segPath = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === segment);
      if (!child) {
        child = { name: segment, path: segPath, children: [] };
        node.children.push(child);
      }
      if (i === parts.length - 1) child.file = f;
      node = child;
    }
  }
  return collapseSingleChildDirs(root);
}

function collapseSingleChildDirs(n: TreeNode): TreeNode {
  n.children = n.children.map(collapseSingleChildDirs);
  if (n.children.length === 1 && !n.children[0].file && n.name) {
    const child = n.children[0];
    return { ...child, name: `${n.name}/${child.name}`, children: child.children };
  }
  return n;
}

export function countFiles(node: TreeNode): number {
  if (node.file) return 1;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}
