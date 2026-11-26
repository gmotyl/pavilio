/** A remote-tracking branch as listed by `GET /api/git/branches`: `ref` is `<remote>/<name>`. */
export interface RemoteBranch {
  ref: string;
  remote: string;
  name: string;
}
