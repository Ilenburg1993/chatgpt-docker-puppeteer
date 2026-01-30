# EXEMPLOS PRÁTICOS DE MISSÕES

## EXEMPLO 1: ESCREVER LIVRO TÉCNICO ("Advanced Rust Programming")

### 1.1 Configuração da Missão

```json
{
  "mission": {
    "id": "mission-rust-book-001",
    "title": "Livro Técnico: Advanced Rust Programming",
    "type": "book_writing",
    "description": "Escrever livro técnico completo sobre Rust avançado, 300 páginas, 15 capítulos, para desenvolvedores experientes",

    "parameters": {
      "topic": "Advanced Rust Programming",
      "num_chapters": 15,
      "target_pages": 300,
      "target_audience": "Experienced developers familiar with Rust basics",
      "style": "technical",
      "include_code_examples": true,
      "include_exercises": true
    },

    "quality_criteria": {
      "min_score_per_chapter": 75,
      "required_elements_per_chapter": [
        "introduction",
        "code_examples",
        "practical_applications",
        "common_pitfalls",
        "summary"
      ],
      "consistency_check": true,
      "code_validation": true
    },

    "budget": {
      "limit_usd": 50,
      "warning_threshold": 40
    },

    "timeline": {
      "estimated_duration_hours": 48,
      "deadline": "2026-02-10T00:00:00Z"
    }
  }
}
```

### 1.2 Workflow Gerado

```json
{
  "workflow": {
    "total_steps": 19,
    "estimated_tasks": 95,
    "steps": [
      {
        "id": "step-1-outline",
        "name": "Generate Book Outline",
        "action": "execute_prompt",
        "estimated_duration_min": 5,
        "estimated_cost_usd": 0.15
      },
      {
        "id": "step-2-chapter-1",
        "name": "Write Chapter 1: Memory Safety Deep Dive",
        "action": "execute_prompt",
        "iterative": true,
        "max_iterations": 3,
        "estimated_duration_min": 45,
        "estimated_cost_usd": 2.50
      },
      // ... chapters 2-15 (similar structure)
      {
        "id": "step-17-consistency",
        "name": "Cross-Chapter Consistency Check",
        "action": "execute_prompt",
        "estimated_duration_min": 30,
        "estimated_cost_usd": 3.00
      },
      {
        "id": "step-18-compile",
        "name": "Compile Final Book",
        "action": "compile",
        "estimated_duration_min": 5,
        "estimated_cost_usd": 0.10
      },
      {
        "id": "step-19-generate-pdf",
        "name": "Generate PDF",
        "action": "export",
        "estimated_duration_min": 2,
        "estimated_cost_usd": 0
      }
    ]
  }
}
```

### 1.3 Execução Timeline (Visualização)

```
Time: 0h 00min | Step 1: Generate Outline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Outline generated (15 chapters, 250 pages est.)
Cost: $0.15 | Progress: 5%

Time: 0h 10min | Step 2: Chapter 1 - Memory Safety (Iteration 1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠ Quality score: 68/100 (below threshold 75)
Issues:
- Missing code examples for borrow checker edge cases
- Lacks practical applications section
Retrying...

Time: 0h 35min | Step 2: Chapter 1 - Memory Safety (Iteration 2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Quality score: 82/100 (passed!)
- Added 4 code examples
- Added "Real-World Applications" section
Cost: $2.80 | Progress: 11%

Time: 1h 25min | Step 3: Chapter 2 - Lifetime Elision Rules (Iteration 1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Quality score: 88/100 (excellent!)
Cost: $2.10 | Progress: 17%

Time: 2h 15min | Step 4: Chapter 3 - Unsafe Rust
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Quality score: 79/100
Cost: $2.30 | Progress: 23%

[... chapters 4-10 continue ...]

Time: 15h 30min | 🚨 USER FEEDBACK RECEIVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User reviewed Chapter 8 and provided feedback:
"Great content, but needs more emphasis on performance implications.
Add benchmarks comparing different approaches. Apply this to remaining chapters."

Action: Stored preference in memory, will apply to chapters 9-15

Time: 16h 00min | Step 11: Chapter 9 - Concurrency Patterns
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Applying user feedback: adding performance benchmarks]
✓ Quality score: 91/100
✓ Includes benchmarks as requested
Cost: $2.90 | Progress: 65%

[... chapters 10-15 continue with feedback applied ...]

Time: 24h 45min | Step 17: Consistency Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analyzing all 15 chapters for consistency...
Found 3 minor inconsistencies:
1. Chapter 3 uses "raw pointer", Chapter 12 uses "unsafe pointer" (same concept)
2. Code style differs in Chapter 7 (uses unwrap() vs expect())
3. Terminology: "thread safety" vs "concurrency safety"

Generating fixes...
✓ All inconsistencies resolved
Cost: $3.20 | Progress: 93%

Time: 25h 15min | Step 18: Compile Final Book
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Compiled: 312 pages, 78,000 words
✓ Table of contents generated
✓ Index generated
Cost: $0.10 | Progress: 98%

Time: 25h 20min | Step 19: Generate PDF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ PDF generated: rust-advanced-book.pdf

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MISSION COMPLETED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Duration: 25h 20min
Total Cost: $42.50 / $50.00 budget
Total Tasks: 87 (75 passed first iteration, 12 required retry)
Avg Quality Score: 84.3/100
User Interventions: 1 (feedback on chapter 8)
Final Output: rust-advanced-book.pdf (312 pages)
```

### 1.4 Artefatos Gerados

```
missions/mission-rust-book-001/
├── state.json                      # Mission state checkpoint
├── outline.txt                     # Generated outline
├── chapters/
│   ├── chapter-01.md               # Chapter 1: Memory Safety
│   ├── chapter-02.md               # Chapter 2: Lifetime Elision
│   ├── chapter-03.md               # Chapter 3: Unsafe Rust
│   ├── ...
│   └── chapter-15.md               # Chapter 15: Production Best Practices
├── outputs/
│   ├── chapter-01-iterations/
│   │   ├── iteration-1.md          # First attempt (quality: 68)
│   │   └── iteration-2.md          # Second attempt (quality: 82) ← USED
│   ├── chapter-02-iterations/
│   │   └── iteration-1.md          # First attempt (quality: 88) ← USED
│   └── ...
├── feedback/
│   └── user-feedback-001.json      # User feedback on chapter 8
├── metrics/
│   ├── quality-scores.json         # Quality scores per chapter
│   ├── cost-breakdown.json         # Cost per step
│   └── token-usage.json            # Token usage details
├── logs/
│   └── execution.log               # Complete execution log
├── final-book.md                   # Compiled markdown
└── rust-advanced-book.pdf          # Final PDF output
```

---

## EXEMPLO 2: DESENVOLVER API REST ("Task Management API")

### 2.1 Configuração da Missão

```json
{
  "mission": {
    "id": "mission-api-rest-001",
    "title": "REST API: Task Management System",
    "type": "software_development",
    "description": "Desenvolver API REST completa para gerenciamento de tarefas com autenticação, CRUD, filtros, e testes",

    "parameters": {
      "project_name": "task-management-api",
      "tech_stack": {
        "language": "Node.js",
        "framework": "Express",
        "database": "PostgreSQL",
        "orm": "Prisma",
        "testing": "Jest",
        "auth": "JWT"
      },
      "features": [
        "User authentication (register, login, JWT)",
        "CRUD operations for tasks",
        "Task filtering (by status, priority, date)",
        "Task assignment to users",
        "File attachments",
        "RESTful API design",
        "Input validation",
        "Error handling",
        "API documentation (OpenAPI/Swagger)",
        "Unit tests (80%+ coverage)",
        "Integration tests"
      ],
      "code_style": {
        "naming": "camelCase",
        "indent": "2 spaces",
        "quotes": "single",
        "linting": "ESLint + Prettier"
      }
    },

    "quality_criteria": {
      "tests_must_pass": true,
      "linting_must_pass": true,
      "min_test_coverage": 80,
      "min_code_quality_score": 75,
      "security_checks": true
    },

    "budget": {
      "limit_usd": 30
    }
  }
}
```

### 2.2 Workflow Gerado

```json
{
  "workflow": {
    "steps": [
      {
        "id": "step-1-architecture",
        "name": "Design API Architecture",
        "action": "execute_prompt"
      },
      {
        "id": "step-2-project-structure",
        "name": "Generate Project Structure",
        "action": "execute_prompt"
      },
      {
        "id": "step-3-database-schema",
        "name": "Design Database Schema (Prisma)",
        "action": "execute_prompt",
        "validation": {
          "type": "custom",
          "validator": "prisma_validate_schema"
        }
      },
      {
        "id": "step-4-loop-features",
        "name": "Implement Features",
        "action": "loop",
        "iterations": 11,  // 11 features
        "loop_body": [
          {
            "id": "implement-feature",
            "action": "execute_prompt",
            "iterative": true,
            "max_iterations": 3,
            "validation": {
              "type": "multiple",
              "validators": [
                { "type": "linting", "config": { "rules": "eslint.json" } },
                { "type": "tests", "config": { "run_tests": true, "min_coverage": 80 } }
              ]
            }
          }
        ]
      },
      {
        "id": "step-5-integration-tests",
        "name": "Write Integration Tests",
        "action": "execute_prompt",
        "validation": {
          "type": "tests",
          "config": { "test_type": "integration" }
        }
      },
      {
        "id": "step-6-api-docs",
        "name": "Generate API Documentation (Swagger)",
        "action": "execute_prompt"
      },
      {
        "id": "step-7-readme",
        "name": "Generate README",
        "action": "execute_prompt"
      }
    ]
  }
}
```

### 2.3 Execução com Testes Automáticos

```
Time: 0h 00min | Step 1: Design Architecture
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Architecture designed:
  - MVC pattern
  - RESTful endpoints
  - JWT middleware
  - Error handling middleware
Cost: $0.20

Time: 0h 10min | Step 2: Project Structure
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Generated 23 files:
  src/
  ├── controllers/
  ├── models/
  ├── routes/
  ├── middleware/
  ├── utils/
  └── ...
Cost: $0.50

Time: 0h 20min | Step 3: Database Schema
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated Prisma schema...
Running validation: prisma validate
✓ Schema valid
Cost: $0.30

Time: 0h 30min | Step 4.1: Feature - User Authentication
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generating code...
Running linter... ✓ Passed
Generating tests...
Running tests...

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Coverage:    85% (above threshold 80%)

✓ Feature complete!
Cost: $2.80

Time: 1h 00min | Step 4.2: Feature - Task CRUD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generating code (Iteration 1)...
Running linter... ✓ Passed
Generating tests...
Running tests...

Test Suites: 1 failed, 1 total
Tests:       3 passed, 2 failed, 5 total

❌ Failed tests:
- "should return 404 for non-existent task"
  Expected: 404
  Received: 500

- "should validate required fields"
  Expected: 400 with validation errors
  Received: 500 (crash)

Retrying with test failure feedback...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Iteration 2: Fixing test failures
Generating improved code...
Running tests...

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Coverage:    88%

✓ All tests passed!
Cost: $3.20

[... features 3-11 continue similarly ...]

Time: 8h 30min | 🚨 USER FEEDBACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User reviewed authentication code:
"Good, but please add rate limiting to prevent brute force attacks on login endpoint.
Also add refresh token mechanism."

Adjusting workflow: Adding 2 new features...
- Feature 12: Rate Limiting
- Feature 13: Refresh Tokens

[... implementing additional features ...]

Time: 10h 45min | Step 5: Integration Tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generating end-to-end integration tests...
Running tests...

Test Suites: 3 passed, 3 total
Tests:       28 passed, 28 total

✓ All integration tests passed!
Cost: $4.50

Time: 11h 00min | Step 6: API Documentation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generating OpenAPI/Swagger documentation...
✓ Generated: swagger.json
✓ Interactive UI available at /api-docs
Cost: $1.20

Time: 11h 15min | Step 7: README
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generating README with:
- Project description
- Installation instructions
- API endpoints documentation
- Environment variables
- Testing instructions
- Deployment guide
✓ Generated: README.md
Cost: $0.80

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MISSION COMPLETED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Duration: 11h 15min
Total Cost: $24.80 / $30.00 budget
Total Files Created: 47
Total Tests: 33 (all passing)
Test Coverage: 87%
Linting: All passed
User Interventions: 1 (added 2 features)
```

### 2.4 Código Gerado (Exemplo)

```javascript
// Generated: src/controllers/taskController.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Get all tasks for authenticated user
 * Supports filtering by status, priority, date range
 */
exports.getTasks = async (req, res, next) => {
  try {
    const { status, priority, dateFrom, dateTo } = req.query;
    const userId = req.user.id;

    const where = {
      userId,
      ...(status && { status }),
      ...(priority && { priority }),
      ...(dateFrom && dateTo && {
        createdAt: {
          gte: new Date(dateFrom),
          lte: new Date(dateTo)
        }
      })
    };

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    next(error);
  }
};

// ... more methods ...
```

```javascript
// Generated: src/controllers/taskController.test.js

const request = require('supertest');
const app = require('../app');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

describe('Task Controller', () => {
  let authToken;
  let userId;

  beforeAll(async () => {
    // Setup test user and get auth token
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      });

    authToken = response.body.token;
    userId = response.body.user.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('GET /api/tasks', () => {
    it('should return empty array for new user', async () => {
      const response = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it('should return user tasks with filters', async () => {
      // Create test task
      await prisma.task.create({
        data: {
          title: 'Test Task',
          description: 'Test',
          status: 'PENDING',
          priority: 'HIGH',
          userId
        }
      });

      const response = await request(app)
        .get('/api/tasks?status=PENDING&priority=HIGH')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.data[0].title).toBe('Test Task');
    });

    it('should return 401 without auth token', async () => {
      const response = await request(app).get('/api/tasks');
      expect(response.status).toBe(401);
    });
  });

  // ... more tests ...
});
```

---

## EXEMPLO 3: PESQUISA E RELATÓRIO ("AI in Healthcare")

### 3.1 Configuração

```json
{
  "mission": {
    "id": "mission-research-001",
    "title": "Research Report: Impact of AI on Healthcare",
    "type": "research_report",

    "parameters": {
      "topic": "Impact of Artificial Intelligence on Healthcare",
      "research_questions": [
        "How is AI currently being used in diagnostic medicine?",
        "What are the measurable outcomes and success rates?",
        "What are the ethical concerns and regulatory challenges?",
        "What is the future outlook for AI in healthcare?"
      ],
      "sources": [
        "https://www.nejm.org/ai-research",
        "https://www.nature.com/subjects/medical-research",
        "https://pubmed.ncbi.nlm.nih.gov/",
        "https://www.who.int/health-topics/artificial-intelligence",
        // ... more sources
      ],
      "output_format": "20-page report with citations",
      "citation_style": "APA 7th",
      "include_charts": true
    },

    "quality_criteria": {
      "min_sources_cited": 25,
      "fact_checking": true,
      "citation_accuracy": true,
      "readability_score": "college_level"
    }
  }
}
```

### 3.2 Execução

```
Time: 0h 00min | Step 1: Fetch Sources (Parallel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fetching 30 sources in parallel...
✓ 28 sources fetched successfully (2 failed: timeouts)
Cost: $1.50

Time: 0h 25min | Step 2: Extract Key Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analyzing each source for relevance...
Extracted:
- 142 key findings
- 67 statistics
- 35 case studies
- 89 expert quotes
Cost: $4.20

Time: 1h 30min | Step 3: Synthesize Findings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Identifying themes and patterns...
Themes identified:
1. Diagnostic AI (45 findings)
2. Treatment Optimization (28 findings)
3. Administrative Automation (19 findings)
4. Ethical Concerns (32 findings)
5. Regulatory Landscape (18 findings)
Cost: $3.80

Time: 2h 00min | Step 4: Generate Report Outline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Outline created (7 sections, 20 pages estimated)
Cost: $0.40

Time: 2h 15min | Step 5.1: Write Section - Introduction
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Written: 2.5 pages, 12 citations
Quality: 86/100
Cost: $2.10

[... sections 2-6 ...]

Time: 6h 30min | Step 5.7: Write Section - Conclusion
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Written: 2 pages, 8 citations
Quality: 84/100
Cost: $1.90

Time: 7h 00min | Step 6: Fact-Check All Claims
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cross-referencing 142 claims with sources...
✓ 138 claims verified (97.2%)
⚠ 4 claims flagged for review:
- Claim: "AI diagnostic accuracy >95% for skin cancer"
  Issue: Source shows 92%, not 95%
  Action: Corrected to 92%

- Claim: "WHO approved 50+ AI medical devices in 2025"
  Issue: WHO doesn't approve devices (FDA does)
  Action: Rephrased: "FDA approved 50+ AI medical devices"

✓ All corrections applied
Cost: $5.20

Time: 7h 30min | Step 7: Generate Charts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated 8 charts:
- AI adoption rates by healthcare sector
- Diagnostic accuracy comparison (AI vs Human)
- Investment in healthcare AI (2020-2025)
- ...
Cost: $2.50

Time: 7h 45min | Step 8: Format Citations (APA 7th)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Formatting 38 citations...
✓ All citations formatted
✓ References page generated
Cost: $1.20

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MISSION COMPLETED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Duration: 7h 45min
Total Cost: $28.90
Sources Used: 28
Citations: 38
Pages: 22
Fact-Check Accuracy: 97.2%
Charts: 8
```

---

## EXEMPLO 4: TRADUÇÃO COMPLEXA (Documentação Técnica Multi-idioma)

### 4.1 Configuração

```json
{
  "mission": {
    "id": "mission-translation-001",
    "title": "Translate Technical Documentation to 5 Languages",
    "type": "content_translation",

    "parameters": {
      "source_content": "product_documentation.md",
      "source_language": "English",
      "target_languages": ["Spanish", "French", "German", "Japanese", "Portuguese (BR)"],
      "domain": "technical_software",
      "maintain_code_blocks": true,
      "maintain_formatting": true,
      "glossary": "technical_glossary.json"
    },

    "quality_criteria": {
      "fluency_score": 85,
      "accuracy_score": 90,
      "terminology_consistency": true,
      "native_review": true  // Flag for human review
    }
  }
}
```

### 4.2 Execução

```
Step 1: Analyze Source Content
- Detected: 45 sections, 12,000 words
- Code blocks: 87
- Technical terms: 234
- Estimated duration per language: 2h

Step 2: Generate Translation Glossary
- Mapped 234 technical terms to each target language
- Example: "authentication" → "autenticación" (ES), "authentification" (FR), etc.

Step 3-7: Translate to Each Language (Parallel)

[Spanish Translation]
✓ Translated: 12,000 words
✓ Code blocks preserved: 87/87
✓ Fluency score: 89/100
✓ Terminology consistency: 98%

[French Translation]
✓ Translated: 12,000 words
✓ Fluency score: 87/100

[German Translation]
✓ Translated: 12,000 words
✓ Fluency score: 91/100

[Japanese Translation]
⚠ Iteration 1: Fluency score: 78/100 (below threshold)
Issues: Some phrases too literal, not idiomatic
Retrying with feedback...
✓ Iteration 2: Fluency score: 86/100 (passed!)

[Portuguese (BR) Translation]
✓ Translated: 12,000 words
✓ Fluency score: 90/100

Step 8: Cross-Language Consistency Check
✓ All versions use consistent technical terminology
✓ All code blocks identical across versions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MISSION COMPLETED
5 complete translations generated
Avg Fluency: 88.6/100
Avg Accuracy: 94.2/100
```

---

## EXEMPLO 5: REFATORAÇÃO DE CÓDIGO (Legacy Codebase Modernization)

### 4.1 Execução

```
Mission: Refactor Legacy jQuery Codebase to React

Step 1: Analyze Existing Code
- Files: 42 JavaScript files
- Lines of code: 15,230
- Complexity score: 78 (high)
- jQuery version: 1.9 (very old)

Step 2: Generate Refactoring Plan
Identified:
- 23 jQuery components → React components
- 8 global variables → React Context
- 15 AJAX calls → Axios + React Query
- CSS: Inline styles → CSS Modules

Step 3-25: Refactor Components (One at a time)

[Component 1: UserProfile.js]
Original: 320 lines of jQuery
Generated: React component (180 lines)
Tests: 8 tests generated, all passing
✓ Complexity reduced: 78 → 35

[Component 2: TaskList.js]
Original: 450 lines
Generated: React component with hooks
Tests: 12 tests, 11 passing, 1 failing

Test failure: "should update task when checkbox clicked"
Analyzing failure...
Fixing...
✓ All tests now passing

[... continue for all 23 components ...]

Step 26: Integration Testing
Running full integration test suite...
✓ 156/156 tests passing

Step 27: Performance Comparison
Old (jQuery): Load time 3.2s, Bundle size 450KB
New (React): Load time 1.1s, Bundle size 180KB
✅ 65% improvement in load time
✅ 60% reduction in bundle size

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MISSION COMPLETED
23 components refactored
15,230 lines → 8,940 lines (41% reduction)
Complexity: 78 → 32 (59% improvement)
Tests: 156 (100% passing)
```

---

## CONCLUSÃO

Estes exemplos demonstram:

1. **Autonomia**: Sistema executa missões complexas do início ao fim
2. **Auto-correção**: Retries automáticos quando quality thresholds não atingidos
3. **Validação Estrutural**: Testes, linting, fact-checking automáticos
4. **Supervisão**: Usuário pode intervir a qualquer momento
5. **Adaptabilidade**: Sistema aprende com feedback e aplica a steps futuros
6. **Persistência**: Checkpoints salvos, crash recovery possível
7. **Observabilidade**: Logs detalhados, métricas, custos trackeados

**Próximo documento**: `05-IMPLEMENTATION_ROADMAP.md` - Roadmap de implementação completo
