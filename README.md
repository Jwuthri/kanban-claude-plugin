# Mission Control

**One board for every Claude session you run.** See at a glance which session waits on you,
which ones are working, which are stuck, and which are done, without clicking through the sidebar.


<img width="1535" height="1025" alt="image" src="https://github.com/user-attachments/assets/9f659242-e18a-4bd5-9259-f163a39f12c5" />

## What you get

| Lane | What lands there |
|---|---|
| **Backlog** | Your own to-dos. Type one and press Enter, or use `/todo <text>`. ✓ removes it. Shared by all your sessions. |
| **Needs you** | A permission prompt, a question or a plan waits on you. Longest wait first, with what to answer. |
| **WIP** | Claude is working (with the tool it runs now), or a session waits on sub-sessions it started. |
| **Blocked** | Running with no activity for 10+ min, the session went silent, or its last turn failed. |
| **Done** | The turn is over: your turn to review. Shows PR status. The 8 newest; "Show all" for the rest. |
| **Background** | Every live session's subagents, with the session that owns each and Open ↗. |

- **Cards** show the title, project, branch, the session that started it, time in the lane, and running sub-sessions.
- **Open ↗** switches the app to that session.
- **Tabs** filter the board to one lane.
- **Small windows:** below about 160 characters wide, the lanes stack top to bottom, Needs you first.
- **Ping:** a toast and a notification when a session starts waiting on you.

## Install

At the prompt of a Claude Code session:

```
/plugin install mission-control --marketplace Jwuthri/kanban-claude-plugin
```

Answer `y` to add the marketplace, then pick a scope (user = every session).

From a shell:

```bash
claude plugin install mission-control --marketplace Jwuthri/kanban-claude-plugin
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**,
**Add marketplace** with `Jwuthri/kanban-claude-plugin`, then **Add plugin**.

To update later: `claude plugin update mission-control@kanban-claude-plugin`. Running sessions switch on their own.

## Use
The board opens beside the chat in every new session. `/mission` opens it again.
Sessions that were already running keep working; they join **Needs you** when they next start.

**Updates:** when a newer version is installed, each session reloads its plugins by itself as soon as it is
idle (a toast says so). A card tagged "old mod version" is a session still on older code; `/reload-plugins`
in that session, or a restart, brings it up to date.

## How it works
- The desktop app's own session list gives every session, its family (who started whom) and its PR.
  The board reads it every 5 s.
- Each session that runs the mod also writes its live state (waiting on you, current tool, errors,
  subagents) to `~/.claude/mission-control/sessions/`. The backlog is `~/.claude/mission-control/backlog.json`.
- Everything stays on your machine. No network calls.

## Known limits
- Built for the Claude desktop app. In a terminal session the board shows only sessions that run the mod.
- After you approve a permission prompt, the card stays in Needs you until that tool call ends.
- Background shows subagents only; background shells and scheduled wake-ups are not visible to mods.
