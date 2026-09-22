- Allow overlaps
- Allow entries to cross line breaks

- Add tool for agent to check offsets, remove `node -e` permission
  - Tool should index the file
  - Agent tells tool to add line/range
  - Tool adds, prints back the line
  - Agent double checks if it is what they intended

The agent should only read the `.INSTRUCTIONS.md` and the text it is assigned to. The rest is irrelevant (no investigating or `git log` shenanigans)

- The agent should fully read `.INSTRUCTIONS.md` and the text it is assigned to into context before starting.
- After that go from top to bottom, and add codes one by one through the tool
- Finally the agent checks back the entire code file
