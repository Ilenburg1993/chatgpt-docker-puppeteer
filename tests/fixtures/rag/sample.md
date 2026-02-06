# Sample Markdown Document

This is a test markdown file for chunking tests.

## Section 1: Introduction

This section contains some introductory text about the RAG system.
It should be chunked separately from other sections.

### Subsection 1.1

More detailed information here.

```javascript
// This code block should be preserved intact
export function example() {
  return "Hello World";
}
```

## Section 2: Features

### Feature A

Description of feature A with multiple lines
that should stay together in the same chunk.

### Feature B

```python
def another_example():
    return "Python code"
```

Description after code block.

## Section 3: Conclusion

Final thoughts and summary.

# Another Top-Level Heading

This starts a new major section.
