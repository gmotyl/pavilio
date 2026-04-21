# QMD Setup & Auto-Indexing

This project uses QMD for semantic search and knowledge management across project notes. Collections have been created for each project folder.

## Collections

Set up one collection per project folder in `projectsDir`. Example:

- **my-work** - N documents indexed
- **my-pet-project** - N documents indexed
- **my-blog** - N documents indexed

## Auto-Reindexing

A **post-commit hook** is configured to automatically reindex the qmd collections whenever markdown files are modified and committed.

### How It Works

The hook (`.git/hooks/post-commit`) runs after each commit and:
1. Checks if any `.md` files were changed
2. If yes, runs `qmd update` to refresh the search index
3. Runs `qmd embed` to generate embeddings for semantic search
4. Logs success/failure to the console

### Manual Commands

If you need to manually reindex:

```bash
# Update all collections
qmd update

# List all collections with their status
qmd collection list

# Add a new collection for a new project folder
qmd collection add projects/projectname --name projectname --mask "**/*.md"

# Generate embeddings (needed after initial collection creation)
qmd embed
```

### Migrating collections after notes/ → projects/ rename

If collections were registered with the old `notes/` path, re-register them:

```bash
qmd collection add projects/my-work --name my-work --mask "**/*.md"
qmd collection add projects/my-pet-project --name my-pet-project --mask "**/*.md"
qmd collection add projects/my-blog --name my-blog --mask "**/*.md"
# ...one line per project folder you want indexed
qmd embed
```

### What Gets Indexed

The collections index all markdown files (`**/*.md`) in each project folder. This includes:
- Memos and notes
- Meeting notes
- Decision records
- Documentation

The index is used for semantic search and knowledge retrieval across the project notes.
