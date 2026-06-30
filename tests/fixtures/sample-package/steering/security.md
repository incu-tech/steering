---
inclusion: always
---

# Security Standards

- Never commit secrets, API keys, or credentials to source control
- Use environment variables for all configuration
- Validate all input at service boundaries
- Follow OWASP Top 10 guidelines
- Use parameterized queries — never string concatenation for SQL
