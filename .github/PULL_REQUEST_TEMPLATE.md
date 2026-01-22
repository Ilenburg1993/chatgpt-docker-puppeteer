## Description

<!-- Describe your changes in detail -->

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## How Has This Been Tested?

<!-- Describe the tests you ran to verify your changes -->

- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual testing

## Checklist

### Code Quality
- [ ] My code follows the project's code style
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] My changes generate no new warnings or errors
- [ ] ESLint passes with `--max-warnings 0`
- [ ] Prettier formatting applied

### Module Aliases (IMPORTANT)
- [ ] I used module aliases (`@core`, `@infra`, `@shared`, etc.) instead of relative paths
- [ ] No deprecated imports (`../../..`) introduced
- [ ] Validated with: `node scripts/validate-ci.js`
- [ ] All imports resolve correctly

### Testing
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Regression tests (P1-P5) still pass
- [ ] Integration tests pass (if applicable)

### Documentation
- [ ] I have updated the documentation accordingly
- [ ] Added JSDoc comments for new functions/classes
- [ ] Updated README.md if public API changed
- [ ] Any dependent changes have been merged and published

## Related Issues

<!-- Link related issues here using #issue_number -->

Closes #
