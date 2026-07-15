# YES, IT'S VIBECODED 🤖

Full transparency: this project was built with heavy AI assistance. Here's the honest story of how it came together.

## The pipeline

1. **Human prototype.** I (the maintainer) built the original rough prototype — the core idea, the concept of an AI copilot living inside the n8n editor, and the first messy proof of concept.
2. **ChatGPT pass.** I handed that prototype to ChatGPT to sketch out a first cut and expand on the idea.
3. **Claude finalized it.** [Claude](https://claude.com/claude-code) (Anthropic's Opus model, via Claude Code) took it the rest of the way and produced the actual shipped product — the real architecture, the working code, and the polish.

So: **human idea + prototype → ChatGPT draft → Claude built the final thing.**

## What Claude actually did

Rather than one-shotting a blob of code, Claude worked like an engineer across many iterations:

- **Investigated the real target.** It inspected a live n8n instance to learn how the app actually works internally, instead of guessing — then built the integration against what it found.
- **Designed the architecture.** The Chrome MV3 extension structure, the split between the page-context bridge and the isolated UI, the custom workflow language and its compiler, the multi-provider AI layer — all designed and implemented by Claude.
- **Wrote and tested the code.** It wrote the modules, then validated the tricky parts (the language compiler, the provider adapters, the conversation model) with its own test harnesses before moving on — catching and fixing real bugs along the way.
- **Iterated on feedback.** Nearly every feature went through "here's a screenshot / here's what's broken → Claude diagnoses and fixes." It debugged live issues from console logs and screenshots, not just abstract descriptions.
- **Handled the boring-but-important stuff.** Privacy scrubbing, licensing, README, `.gitignore`, and the GitHub setup.

## Why say this out loud

AI-assisted code has a reputation, and hiding it helps no one. This project was genuinely designed, debugged, and shipped with an AI doing the bulk of the implementation — and it was reviewed, directed, and steered by a human the whole way. That's the workflow. It works.

If that bothers you, that's fair — but at least you know exactly what you're looking at. 🫡
