---
name: best-practices
description: Comprehensive guide and best practices for agentic coding, context management, prompt patterns, and quality assurance. Use when planning refactors, designing workflows, or reviewing coding standards.
---

# Best Practices for Agentic Coding

A comprehensive guide to effective AI-assisted development using structured rules, context management, and proven workflows.

## Core Philosophy

### The Golden Rule: Context is King
AI agents are only as good as the context and rules you provide.

Key Principles:
1. **Explicit Over Implicit**: "Use TypeScript strict mode" beats "follow best practices"
2. **Concrete Over Abstract**: "Copy `src/components/Button.tsx` pattern" beats "use good patterns"
3. **Show, Don't Tell**: Reference actual files rather than describing patterns
4. **Iterate Based on Behavior**: Add rules when you see repeated mistakes
5. **Security First**: Never trust AI-generated code without review

## Rule Design Principles

1. **Be Specific and Actionable**
2. **Use Examples from Your Codebase**
3. **Create Rule Hierarchies**
4. **Tag Rules for Traceability**
5. **Use Positive and Negative Examples**
6. **Document the "Why"**

## Workflow Patterns

### Feature Development Workflow
- Create feature branch
- Write tests first (TDD when appropriate)
- Implement minimal solution
- Run file-scoped checks
- Perform self-code-review
- Run full test suite before submission

### Bug Fix Workflow
- Reproduce: Write failing test demonstrating bug
- Isolate: Identify exact code causing issue
- Fix: Minimal change to pass test
- Verify: Ensure test now passes
- Regression: Add tests for related edge cases

### Code Review Checklist
- Functionality: Edge cases handled, error states graceful
- Code Quality: No code duplication, comments explain "why"
- Testing: Unit and integration tests included
- Security: Input validation, no secrets in code, parameterized queries
- Performance: Optimized DB queries, no unnecessary computations
