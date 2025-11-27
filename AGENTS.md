# Agents & Roles

In `coc-ai`, "Agents" are implemented as **Roles**. A role is a named configuration that can include a specific system prompt, model settings, or connection parameters. This allows you to quickly switch between different "personas" or AI backends (e.g., a code reviewer, a grammar fixer, or a specific model like GPT-4 vs DeepSeek).

## Configuration

Roles are defined in a TOML file. You can specify the path to this file in your `coc-settings.json` using the `coc-ai.global.rolesConfigPath` setting. Additionally, you can enable/disable the AI tab completion feature using the `coc-ai.tab.enabled` setting in `coc-settings.json`.

A default example is provided in `roles-example.toml`.

### Structure

A role is defined by a section header `[role-name]`.

```toml
[role-name]
prompt = "You are a helpful assistant..." # Prepend to user prompt

# General options for this role
[role-name.options]
model = "model-name"
temperature = 0.7

# Task-specific overrides (optional)
[role-name.options-chat]
model = "chat-specific-model"

[role-name.options-edit]
temperature = 0.2
```

## Usage

You can use a role in any AI command (`:AIChat`, `:AIEdit`, `:AI`) by prefixing the role name with a forward slash `/`.

```vim
:AIChat /grammar Fix this sentence.
:AIEdit /refactor
```

### Chaining & Mixins

You can chain multiple roles. Configurations are merged in order, meaning later roles override earlier ones. This is useful for "mixins" that only change the model or a specific setting.

```vim
" Use the 'refactor' prompt but switch the model to the one defined in 'r1'
:AIChat /refactor /r1
```

## Built-in Examples

The following examples are commonly used and included in `roles-example.toml`:

### Productivity
- **`/grammar`**: Fixes spelling and grammar errors.
- **`/refactor`**: Refactors code for cleanliness and maintainability, adding explanations for the changes.
- **`/explain`**: Explains code snippets, focusing on purpose and implementation details.
- **`/review`**: Specific code review focusing on security, performance, and best practices.

### Model/Backend Presets
- **`/r1`**: Switches to the `deepseek-reasoner` model with specific API endpoints.
- **`/4om`**: Switches to `gpt-4o-mini` using a local proxy.

## Creating Your Own Agent

To create a custom agent, simply add a new entry to your roles TOML file.

**Example: A Python Expert**

```toml
[python]
prompt = "You are a senior Python developer. Prefer using type hints and Pydantic models."

[python.options]
temperature = 0.2
```

**Usage:**
```vim
:AIC /python Write a fastAPI endpoint
```

## Project Information

This project uses `yarn` for package management.
