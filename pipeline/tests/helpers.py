"""Shared helpers for the pipeline tests."""
import os
from typing import Dict, Tuple


def snapshot(root: str) -> Dict[str, Tuple]:
    """Everything under root as {relative path: (kind, size, mtime_ns, link target)}, without following symlinks.

    Comparing two snapshots shows any file or directory that was created, replaced, removed or rewritten,
    so "nothing was written" and "the outside file is untouched" are assertions that can actually fail.
    """
    out: Dict[str, Tuple] = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in dirnames + filenames:
            path = os.path.join(dirpath, name)
            st = os.lstat(path)
            if os.path.islink(path):
                out[os.path.relpath(path, root)] = ("link", 0, st.st_mtime_ns, os.readlink(path))
            elif os.path.isdir(path):
                out[os.path.relpath(path, root)] = ("dir", 0, 0, "")
            else:
                out[os.path.relpath(path, root)] = ("file", st.st_size, st.st_mtime_ns, "")
    return out
