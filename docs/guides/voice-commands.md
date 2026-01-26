# Voice Commands Reference

Atlas understands natural language, so you do not need to memorize specific phrases. This reference shows examples of what you can ask, organized by category.

---

## Table of Contents

1. [General Conversation](#general-conversation)
2. [File Operations](#file-operations)
3. [Terminal Commands](#terminal-commands)
4. [Git Operations](#git-operations)
5. [Web Search and Browsing](#web-search-and-browsing)
6. [Screenshot and Clipboard](#screenshot-and-clipboard)
7. [System Information](#system-information)
8. [Application Control](#application-control)
9. [Tips for Better Recognition](#tips-for-better-recognition)

---

## General Conversation

Atlas can engage in natural conversation and answer general questions.

### Greetings and Help

| What You Want | Example Phrases |
|---------------|-----------------|
| Start conversation | "Hello" / "Hi Atlas" / "Hey there" |
| Get help | "What can you do?" / "Help me" / "What are your capabilities?" |
| End conversation | "Thank you" / "That's all" / "Goodbye" |

### General Questions

| What You Want | Example Phrases |
|---------------|-----------------|
| Current time | "What time is it?" / "Tell me the time" |
| Current date | "What's today's date?" / "What day is it?" |
| Quick calculation | "What's 15 times 23?" / "Calculate 100 divided by 7" |
| Definitions | "What does [word] mean?" / "Define [term]" |

### Fun and Entertainment

| What You Want | Example Phrases |
|---------------|-----------------|
| Hear a joke | "Tell me a joke" / "Make me laugh" |
| Get a fact | "Tell me an interesting fact" / "Surprise me with something" |
| Trivia | "Quiz me on [topic]" / "Ask me a trivia question" |

---

## File Operations

Atlas can read, write, search, and manage files on your system.

### Reading Files

| What You Want | Example Phrases |
|---------------|-----------------|
| Read a file | "Read the file readme.md" / "Show me the contents of config.json" |
| Read specific lines | "Read lines 10 to 20 of main.ts" |
| Read from path | "Read the file at C:/Users/me/document.txt" |

**Examples:**
- "Read the package.json file"
- "Show me what's in the .env file"
- "What does the README say?"

### Writing Files

| What You Want | Example Phrases |
|---------------|-----------------|
| Create a file | "Create a file called notes.txt" |
| Write content | "Write 'Hello World' to hello.txt" |
| Append to file | "Add a line to notes.txt saying 'New entry'" |

**Examples:**
- "Create a new file called todo.md with a heading 'My Tasks'"
- "Write a simple HTML template to index.html"

### Listing and Searching

| What You Want | Example Phrases |
|---------------|-----------------|
| List files | "What files are in this folder?" / "List the files here" |
| List specific directory | "List files in the src folder" / "Show me what's in documents" |
| Search by name | "Find all TypeScript files" / "Search for files named config" |
| Search by content | "Find files containing 'TODO'" / "Search for files with 'error'" |

**Examples:**
- "Show me all JavaScript files in this project"
- "Find files that mention 'database'"
- "What folders are in the current directory?"

### File Management

| What You Want | Example Phrases |
|---------------|-----------------|
| Delete file | "Delete the file temp.txt" (requires confirmation) |
| Move file | "Move report.pdf to the archive folder" |
| Copy file | "Copy config.json to backup.json" |
| Rename file | "Rename old.txt to new.txt" |

**Note:** Destructive operations like delete require confirmation.

---

## Terminal Commands

Atlas can execute shell commands on your behalf.

### Running Commands

| What You Want | Example Phrases |
|---------------|-----------------|
| Run a command | "Run npm install" / "Execute ls -la" |
| Run in directory | "Run npm test in the frontend folder" |

**Examples:**
- "Run npm install"
- "Execute pip install requests"
- "Run git status"
- "Show me the output of 'node --version'"

### Common Development Commands

| What You Want | Example Phrases |
|---------------|-----------------|
| Install packages | "Run npm install" / "Install Python dependencies with pip" |
| Run tests | "Run the tests" / "Execute npm test" |
| Build project | "Build the project" / "Run npm run build" |
| Start server | "Start the dev server" / "Run npm run dev" |

### System Commands

| What You Want | Example Phrases |
|---------------|-----------------|
| Check processes | "Show running processes" / "What's using port 3000?" |
| Check disk space | "How much disk space is left?" / "Show disk usage" |
| Check memory | "Show memory usage" / "How much RAM is being used?" |

**Warning:** Dangerous commands (like `rm -rf`) will require explicit confirmation before execution.

---

## Git Operations

Atlas provides comprehensive Git support for repository management.

### Repository Status

| What You Want | Example Phrases |
|---------------|-----------------|
| Check status | "What's the git status?" / "Show me uncommitted changes" |
| View diff | "Show me what changed" / "What are the differences?" |
| View logs | "Show recent commits" / "What were the last 5 commits?" |

**Examples:**
- "Git status"
- "Show me the changes I made"
- "What commits did I make today?"

### Branching

| What You Want | Example Phrases |
|---------------|-----------------|
| List branches | "What branches exist?" / "Show me all branches" |
| Current branch | "What branch am I on?" |
| Create branch | "Create a new branch called feature-x" |
| Switch branch | "Switch to the main branch" / "Checkout develop" |
| Delete branch | "Delete the old-feature branch" |

**Examples:**
- "Create a branch called fix/login-bug"
- "Switch to the development branch"
- "What's the current branch?"

### Committing Changes

| What You Want | Example Phrases |
|---------------|-----------------|
| Stage files | "Add all changes" / "Stage the modified files" |
| Create commit | "Commit with message 'fix: resolved bug'" |
| View staged | "What's staged for commit?" |

**Examples:**
- "Commit these changes with the message 'feat: add user authentication'"
- "Stage all modified files and commit"

### Remote Operations

| What You Want | Example Phrases |
|---------------|-----------------|
| Push changes | "Push to origin" / "Push my commits" |
| Pull changes | "Pull from remote" / "Get latest changes" |
| Fetch updates | "Fetch from origin" |

**Examples:**
- "Push my changes to the main branch"
- "Pull the latest from develop"

### Advanced Git

| What You Want | Example Phrases |
|---------------|-----------------|
| Merge branch | "Merge feature into main" |
| Rebase | "Rebase onto main" |
| Cherry-pick | "Cherry-pick commit abc123" |
| Stash changes | "Stash my changes" / "Pop the stash" |
| View blame | "Who wrote this line?" / "Git blame for file.ts" |

---

## Web Search and Browsing

Atlas can search the web and browse pages.

### Web Search

| What You Want | Example Phrases |
|---------------|-----------------|
| Search web | "Search for [topic]" / "Look up [query]" |
| Research | "Find information about [subject]" |
| Current events | "What's the latest news about [topic]?" |

**Examples:**
- "Search for TypeScript best practices"
- "What's the latest news about artificial intelligence?"
- "Find tutorials on React hooks"

### Web Browsing

| What You Want | Example Phrases |
|---------------|-----------------|
| Open URL | "Open google.com" / "Go to github.com" |
| Navigate | "Navigate to [website]" |
| Fetch content | "What's on the Hacker News homepage?" |

**Examples:**
- "Open YouTube"
- "Go to the React documentation"
- "What's on the front page of Reddit?"

### Page Interaction

| What You Want | Example Phrases |
|---------------|-----------------|
| Screenshot page | "Take a screenshot of this page" |
| Click element | "Click the login button" |
| Fill form | "Type my email in the email field" |
| Scroll page | "Scroll down" / "Scroll to the bottom" |

---

## Screenshot and Clipboard

Atlas can capture your screen and manage the clipboard.

### Screenshots

| What You Want | Example Phrases |
|---------------|-----------------|
| Capture screen | "Take a screenshot" / "Capture my screen" |
| Capture window | "Screenshot the current window" |
| Capture region | "Capture just this area" |

**Examples:**
- "Take a screenshot of my desktop"
- "Capture the current application window"

### Clipboard

| What You Want | Example Phrases |
|---------------|-----------------|
| Read clipboard | "What's in my clipboard?" / "Read my clipboard" |
| Copy text | "Copy 'Hello World' to clipboard" |
| Copy result | "Copy that to my clipboard" |

**Examples:**
- "What did I just copy?"
- "Put this code in my clipboard"

---

## System Information

Atlas can provide information about your system.

### System Status

| What You Want | Example Phrases |
|---------------|-----------------|
| Memory usage | "How much RAM is being used?" |
| CPU usage | "What's my CPU usage?" |
| Disk space | "How much disk space is left?" |
| Battery | "What's my battery level?" |

### Network Information

| What You Want | Example Phrases |
|---------------|-----------------|
| Network status | "Am I connected to the internet?" |
| IP address | "What's my IP address?" |
| WiFi info | "What WiFi network am I on?" |

---

## Application Control

Atlas can help manage and launch applications.

### Launching Applications

| What You Want | Example Phrases |
|---------------|-----------------|
| Open app | "Open [application name]" |
| Start program | "Launch [program]" |
| Open folder | "Open my Documents folder" |

**Examples:**
- "Open Visual Studio Code"
- "Launch the calculator"
- "Open my Downloads folder"

### System Actions

| What You Want | Example Phrases |
|---------------|-----------------|
| Open settings | "Open system settings" |
| Open terminal | "Open a terminal window" |
| Open browser | "Open my web browser" |

---

## Tips for Better Recognition

### Speak Clearly

- Enunciate words distinctly
- Avoid mumbling or speaking too quickly
- Use a consistent speaking pace

### Reduce Background Noise

- Move to a quieter location when possible
- Close windows to reduce outside noise
- Position your microphone closer to your mouth

### Be Specific

Instead of vague requests, be specific:

| Less Clear | More Clear |
|------------|------------|
| "Open that file" | "Open the readme.md file" |
| "Search for stuff" | "Search for Python tutorials" |
| "Run it" | "Run npm test" |

### Use Natural Language

Atlas understands natural speech. You do not need to use specific keywords:

| Robotic | Natural |
|---------|---------|
| "File read readme.md" | "Read the readme file" |
| "Terminal execute npm install" | "Run npm install" |
| "Git status check" | "What's the git status?" |

### Wait for the Listening State

After saying the wake word:
1. Wait for the orb to pulse cyan
2. Then speak your request
3. Pause when finished (1-2 seconds)
4. Atlas will process your request

### Handle Misunderstandings

If Atlas misunderstands:
- Try rephrasing your request
- Speak more slowly and clearly
- Use simpler language
- Say "cancel" to stop and try again

---

## Command Patterns Quick Reference

### File Commands

```
"Read [filename]"
"Create a file called [name]"
"List files in [folder]"
"Find files containing [text]"
"Delete [filename]" (requires confirmation)
```

### Terminal Commands

```
"Run [command]"
"Execute [command]"
"Show me the output of [command]"
```

### Git Commands

```
"Git status"
"Show recent commits"
"Create branch [name]"
"Commit with message '[message]'"
"Push to [remote]"
```

### Search Commands

```
"Search for [query]"
"Look up [topic]"
"Find information about [subject]"
```

### Browser Commands

```
"Open [url]"
"Go to [website]"
"Take a screenshot of this page"
```

---

## Emergency Commands

If something goes wrong:

| Situation | What to Say |
|-----------|-------------|
| Stop current action | "Cancel" / "Stop" / Press `Escape` |
| Mute Atlas | Press `Ctrl+Shift+M` |
| Hide window | Press `Ctrl+Shift+A` |

---

*This reference covers the most common voice commands. Atlas is continuously learning and improving. If you discover new ways to interact, feel free to experiment!*
