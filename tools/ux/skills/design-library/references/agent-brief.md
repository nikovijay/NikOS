# The agent brief

`libraryPrompt()` prints the design language as Markdown another coding agent
can follow without seeing the page. Build it from the data module's arrays,
never from a hand-written string, so it changes when they do.

```md
# <Product> design language

Use it for <where it applies>. It does not apply to <where it doesn't>.
Tokens live in <source file>. Library: <URL of the library page>.

## Principles
1. <Title>. <Body>
…

## Colour
- <Meaning word> (<token>): <what it means>.
<Group> (<pattern>):
- <token> <light value> / <dark value>: <name>. <use>
…

## Type
- <Role>: `<class or CSS>`. <note>
…

## Layout and shape
- <Gutter>: `<css>`. <use>
- Spacing: <scale summary>. Section padding: <rhythm>.
- Radius: <token> (<px>), …
- Shadows: <name>: `<css>`. <use>

## Components
- <Name> (<source>): <when to use it>.
…

## Do
- …

## Don't
- …
```

Keep it under about 150 lines: an agent should read it in one go. Link to the
library page for anything visual the text can't carry.
