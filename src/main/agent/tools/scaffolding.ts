/**
 * Atlas Desktop - Project Scaffolding
 * 
 * Generate boilerplate code and project templates:
 * - React/Next.js components
 * - Express/Fastify routes
 * - Database models
 * - Test files
 * - Configuration files
 * 
 * @module agent/tools/scaffolding
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('Scaffolding');

// ============================================================================
// 1. CREATE REACT COMPONENT
// ============================================================================

/**
 * Generate React/Next.js components
 */
export const createComponentTool: AgentTool = {
  name: 'create_component',
  description: `Create React/Next.js components with best practices:
- Functional components with hooks
- TypeScript interfaces
- CSS modules or styled-components
- Optional test file
- Storybook story`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Component name (PascalCase)',
      },
      directory: {
        type: 'string',
        description: 'Target directory (default: src/components)',
      },
      type: {
        type: 'string',
        enum: ['functional', 'page', 'layout', 'provider'],
        description: 'Component type',
      },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: 'Features: useState, useEffect, useContext, memo, forwardRef',
      },
      withTest: {
        type: 'boolean',
        description: 'Generate test file',
      },
      withStory: {
        type: 'boolean',
        description: 'Generate Storybook story',
      },
      styling: {
        type: 'string',
        enum: ['css-modules', 'styled-components', 'tailwind', 'none'],
        description: 'Styling approach',
      },
    },
    required: ['name'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const name = params.name as string;
    const directory = (params.directory as string) || 'src/components';
    const type = (params.type as string) || 'functional';
    const features = (params.features as string[]) || [];
    const withTest = params.withTest as boolean;
    const withStory = params.withStory as boolean;
    const styling = (params.styling as string) || 'none';

    try {
      const componentDir = path.join(directory, name);
      await fs.mkdir(componentDir, { recursive: true });

      const createdFiles: string[] = [];

      // Generate component
      const componentCode = generateReactComponent(name, type, features, styling);
      const componentFile = path.join(componentDir, `${name}.tsx`);
      await fs.writeFile(componentFile, componentCode, 'utf-8');
      createdFiles.push(componentFile);

      // Generate styles
      if (styling === 'css-modules') {
        const stylesCode = generateCssModule(name);
        const stylesFile = path.join(componentDir, `${name}.module.css`);
        await fs.writeFile(stylesFile, stylesCode, 'utf-8');
        createdFiles.push(stylesFile);
      } else if (styling === 'styled-components') {
        const stylesCode = generateStyledComponents(name);
        const stylesFile = path.join(componentDir, `${name}.styles.ts`);
        await fs.writeFile(stylesFile, stylesCode, 'utf-8');
        createdFiles.push(stylesFile);
      }

      // Generate test
      if (withTest) {
        const testCode = generateComponentTest(name);
        const testFile = path.join(componentDir, `${name}.test.tsx`);
        await fs.writeFile(testFile, testCode, 'utf-8');
        createdFiles.push(testFile);
      }

      // Generate story
      if (withStory) {
        const storyCode = generateStory(name);
        const storyFile = path.join(componentDir, `${name}.stories.tsx`);
        await fs.writeFile(storyFile, storyCode, 'utf-8');
        createdFiles.push(storyFile);
      }

      // Generate index
      const indexCode = `export { default } from './${name}';\nexport * from './${name}';\n`;
      const indexFile = path.join(componentDir, 'index.ts');
      await fs.writeFile(indexFile, indexCode, 'utf-8');
      createdFiles.push(indexFile);

      return {
        success: true,
        data: {
          name,
          directory: componentDir,
          files: createdFiles,
          type,
          features,
          styling,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

function generateReactComponent(
  name: string,
  type: string,
  features: string[],
  styling: string
): string {
  const lines: string[] = [];

  // Imports
  const reactImports: string[] = [];
  if (type === 'provider') {
    reactImports.push('createContext', 'useContext');
  }
  if (features.includes('useState')) reactImports.push('useState');
  if (features.includes('useEffect')) reactImports.push('useEffect');
  if (features.includes('useContext')) reactImports.push('useContext');
  if (features.includes('memo')) reactImports.push('memo');
  if (features.includes('forwardRef')) reactImports.push('forwardRef');

  if (reactImports.length > 0) {
    lines.push(`import React, { ${reactImports.join(', ')} } from 'react';`);
  } else {
    lines.push(`import React from 'react';`);
  }

  if (styling === 'css-modules') {
    lines.push(`import styles from './${name}.module.css';`);
  } else if (styling === 'styled-components') {
    lines.push(`import { Container } from './${name}.styles';`);
  }

  lines.push('');

  // Props interface
  lines.push(`export interface ${name}Props {`);
  if (type === 'page') {
    lines.push(`  params?: Record<string, string>;`);
  }
  lines.push(`  children?: React.ReactNode;`);
  lines.push(`  className?: string;`);
  lines.push(`}`);
  lines.push('');

  // Context for providers
  if (type === 'provider') {
    lines.push(`interface ${name}ContextValue {`);
    lines.push(`  // Add context values here`);
    lines.push(`}`);
    lines.push('');
    lines.push(`const ${name}Context = createContext<${name}ContextValue | undefined>(undefined);`);
    lines.push('');
    lines.push(`export const use${name} = () => {`);
    lines.push(`  const context = useContext(${name}Context);`);
    lines.push(`  if (!context) {`);
    lines.push(`    throw new Error('use${name} must be used within a ${name}');`);
    lines.push(`  }`);
    lines.push(`  return context;`);
    lines.push(`};`);
    lines.push('');
  }

  // Component
  const componentDef = features.includes('forwardRef')
    ? `export const ${name} = forwardRef<HTMLDivElement, ${name}Props>(`
    : features.includes('memo')
    ? `const ${name}: React.FC<${name}Props> = memo(`
    : `const ${name}: React.FC<${name}Props> =`;

  if (features.includes('forwardRef')) {
    lines.push(`${componentDef}`);
    lines.push(`  ({ children, className }, ref) => {`);
  } else if (features.includes('memo')) {
    lines.push(`${componentDef}`);
    lines.push(`  ({ children, className }) => {`);
  } else {
    lines.push(`${componentDef} ({ children, className }) => {`);
  }

  // State
  if (features.includes('useState')) {
    lines.push(`  const [state, setState] = useState<unknown>(null);`);
    lines.push('');
  }

  // Effect
  if (features.includes('useEffect')) {
    lines.push(`  useEffect(() => {`);
    lines.push(`    // Side effect logic here`);
    lines.push(`    return () => {`);
    lines.push(`      // Cleanup`);
    lines.push(`    };`);
    lines.push(`  }, []);`);
    lines.push('');
  }

  // Return
  const classNameAttr = styling === 'css-modules'
    ? `className={\`\${styles.container} \${className || ''}\`}`
    : styling === 'tailwind'
    ? `className={\`p-4 \${className || ''}\`}`
    : `className={className}`;

  if (type === 'provider') {
    lines.push(`  const value: ${name}ContextValue = {`);
    lines.push(`    // Add context values here`);
    lines.push(`  };`);
    lines.push('');
    lines.push(`  return (`);
    lines.push(`    <${name}Context.Provider value={value}>`);
    lines.push(`      {children}`);
    lines.push(`    </${name}Context.Provider>`);
    lines.push(`  );`);
  } else if (styling === 'styled-components') {
    lines.push(`  return (`);
    lines.push(`    <Container ${classNameAttr}${features.includes('forwardRef') ? ' ref={ref}' : ''}>`);
    lines.push(`      {children}`);
    lines.push(`    </Container>`);
    lines.push(`  );`);
  } else {
    lines.push(`  return (`);
    lines.push(`    <div ${classNameAttr}${features.includes('forwardRef') ? ' ref={ref}' : ''}>`);
    lines.push(`      {children}`);
    lines.push(`    </div>`);
    lines.push(`  );`);
  }

  // Close component
  if (features.includes('forwardRef') || features.includes('memo')) {
    lines.push(`  }`);
    lines.push(`);`);
    if (features.includes('forwardRef')) {
      lines.push('');
      lines.push(`${name}.displayName = '${name}';`);
    }
  } else {
    lines.push(`};`);
  }

  lines.push('');
  lines.push(`export default ${name};`);

  return lines.join('\n');
}

function generateCssModule(name: string): string {
  return `.container {
  /* ${name} styles */
  display: flex;
  flex-direction: column;
}

.header {
  /* Header styles */
}

.content {
  /* Content styles */
}

.footer {
  /* Footer styles */
}
`;
}

function generateStyledComponents(name: string): string {
  return `import styled from 'styled-components';

export const Container = styled.div\`
  /* ${name} styles */
  display: flex;
  flex-direction: column;
\`;

export const Header = styled.header\`
  /* Header styles */
\`;

export const Content = styled.main\`
  /* Content styles */
\`;

export const Footer = styled.footer\`
  /* Footer styles */
\`;
`;
}

function generateComponentTest(name: string): string {
  return `import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ${name} from './${name}';

describe('${name}', () => {
  it('renders without crashing', () => {
    render(<${name} />);
  });

  it('renders children', () => {
    render(<${name}>Test Content</${name}>);
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<${name} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  // Add more tests here
});
`;
}

function generateStory(name: string): string {
  return `import type { Meta, StoryObj } from '@storybook/react';
import ${name} from './${name}';

const meta: Meta<typeof ${name}> = {
  title: 'Components/${name}',
  component: ${name},
  tags: ['autodocs'],
  argTypes: {
    className: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof ${name}>;

export const Default: Story = {
  args: {
    children: 'Default content',
  },
};

export const WithCustomClass: Story = {
  args: {
    children: 'Content with custom class',
    className: 'custom-class',
  },
};
`;
}

// ============================================================================
// 2. CREATE API ROUTE
// ============================================================================

/**
 * Generate API routes (Express, Fastify, Next.js)
 */
export const createApiRouteTool: AgentTool = {
  name: 'create_api_route',
  description: `Create API route handlers:
- Express/Fastify routes
- Next.js API routes
- RESTful CRUD operations
- Input validation
- Error handling`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Route/resource name',
      },
      framework: {
        type: 'string',
        enum: ['express', 'fastify', 'nextjs-pages', 'nextjs-app'],
        description: 'Framework/style',
      },
      methods: {
        type: 'array',
        items: { type: 'string' },
        description: 'HTTP methods: GET, POST, PUT, PATCH, DELETE',
      },
      directory: {
        type: 'string',
        description: 'Target directory',
      },
      withValidation: {
        type: 'boolean',
        description: 'Include input validation (zod)',
      },
    },
    required: ['name', 'framework'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const name = params.name as string;
    const framework = params.framework as string;
    const methods = (params.methods as string[]) || ['GET', 'POST', 'PUT', 'DELETE'];
    const directory = params.directory as string;
    const withValidation = params.withValidation !== false;

    try {
      let code: string;
      let filePath: string;

      switch (framework) {
        case 'express':
          code = generateExpressRoute(name, methods, withValidation);
          filePath = path.join(directory || 'src/routes', `${name}.ts`);
          break;

        case 'fastify':
          code = generateFastifyRoute(name, methods, withValidation);
          filePath = path.join(directory || 'src/routes', `${name}.ts`);
          break;

        case 'nextjs-pages':
          code = generateNextJsPagesRoute(name, methods, withValidation);
          filePath = path.join(directory || 'pages/api', `${name}.ts`);
          break;

        case 'nextjs-app':
          code = generateNextJsAppRoute(name, methods, withValidation);
          filePath = path.join(directory || 'app/api', name, 'route.ts');
          break;

        default:
          return { success: false, error: `Unknown framework: ${framework}` };
      }

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, code, 'utf-8');

      return {
        success: true,
        data: {
          name,
          framework,
          methods,
          file: filePath,
          withValidation,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

function generateExpressRoute(name: string, methods: string[], withValidation: boolean): string {
  const lines: string[] = [];

  lines.push(`import { Router, Request, Response, NextFunction } from 'express';`);
  if (withValidation) {
    lines.push(`import { z } from 'zod';`);
  }
  lines.push('');

  if (withValidation) {
    lines.push(`const ${name}Schema = z.object({`);
    lines.push(`  // Define your schema here`);
    lines.push(`  name: z.string().min(1),`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`const router = Router();`);
  lines.push('');

  for (const method of methods) {
    const lowerMethod = method.toLowerCase();

    lines.push(`/**`);
    lines.push(` * ${method} /${name}`);
    lines.push(` */`);
    lines.push(`router.${lowerMethod}('/', async (req: Request, res: Response, next: NextFunction) => {`);
    lines.push(`  try {`);

    if (withValidation && ['POST', 'PUT', 'PATCH'].includes(method)) {
      lines.push(`    const data = ${name}Schema.parse(req.body);`);
    }

    switch (method) {
      case 'GET':
        lines.push(`    // Fetch ${name}(s)`);
        lines.push(`    const items = []; // TODO: Implement`);
        lines.push(`    res.json(items);`);
        break;
      case 'POST':
        lines.push(`    // Create ${name}`);
        lines.push(`    const created = {}; // TODO: Implement`);
        lines.push(`    res.status(201).json(created);`);
        break;
      case 'PUT':
      case 'PATCH':
        lines.push(`    // Update ${name}`);
        lines.push(`    const updated = {}; // TODO: Implement`);
        lines.push(`    res.json(updated);`);
        break;
      case 'DELETE':
        lines.push(`    // Delete ${name}`);
        lines.push(`    res.status(204).send();`);
        break;
    }

    lines.push(`  } catch (error) {`);
    lines.push(`    next(error);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`export default router;`);

  return lines.join('\n');
}

function generateFastifyRoute(name: string, methods: string[], withValidation: boolean): string {
  const lines: string[] = [];

  lines.push(`import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';`);
  if (withValidation) {
    lines.push(`import { z } from 'zod';`);
  }
  lines.push('');

  if (withValidation) {
    lines.push(`const ${name}Schema = z.object({`);
    lines.push(`  name: z.string().min(1),`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`export default async function ${name}Routes(fastify: FastifyInstance) {`);

  for (const method of methods) {
    const lowerMethod = method.toLowerCase();

    lines.push('');
    lines.push(`  fastify.${lowerMethod}('/', async (request: FastifyRequest, reply: FastifyReply) => {`);

    if (withValidation && ['POST', 'PUT', 'PATCH'].includes(method)) {
      lines.push(`    const data = ${name}Schema.parse(request.body);`);
    }

    switch (method) {
      case 'GET':
        lines.push(`    return []; // TODO: Implement`);
        break;
      case 'POST':
        lines.push(`    reply.code(201);`);
        lines.push(`    return {}; // TODO: Implement`);
        break;
      case 'PUT':
      case 'PATCH':
        lines.push(`    return {}; // TODO: Implement`);
        break;
      case 'DELETE':
        lines.push(`    reply.code(204).send();`);
        break;
    }

    lines.push(`  });`);
  }

  lines.push(`}`);

  return lines.join('\n');
}

function generateNextJsPagesRoute(name: string, methods: string[], withValidation: boolean): string {
  const lines: string[] = [];

  lines.push(`import type { NextApiRequest, NextApiResponse } from 'next';`);
  if (withValidation) {
    lines.push(`import { z } from 'zod';`);
  }
  lines.push('');

  if (withValidation) {
    lines.push(`const ${name}Schema = z.object({`);
    lines.push(`  name: z.string().min(1),`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`type ResponseData = {`);
  lines.push(`  message?: string;`);
  lines.push(`  data?: unknown;`);
  lines.push(`  error?: string;`);
  lines.push(`};`);
  lines.push('');

  lines.push(`export default async function handler(`);
  lines.push(`  req: NextApiRequest,`);
  lines.push(`  res: NextApiResponse<ResponseData>`);
  lines.push(`) {`);
  lines.push(`  const { method } = req;`);
  lines.push('');
  lines.push(`  try {`);
  lines.push(`    switch (method) {`);

  for (const method of methods) {
    lines.push(`      case '${method}':`);

    if (withValidation && ['POST', 'PUT', 'PATCH'].includes(method)) {
      lines.push(`        const data = ${name}Schema.parse(req.body);`);
    }

    switch (method) {
      case 'GET':
        lines.push(`        return res.status(200).json({ data: [] });`);
        break;
      case 'POST':
        lines.push(`        return res.status(201).json({ data: {} });`);
        break;
      case 'PUT':
      case 'PATCH':
        lines.push(`        return res.status(200).json({ data: {} });`);
        break;
      case 'DELETE':
        lines.push(`        return res.status(204).end();`);
        break;
    }
  }

  lines.push(`      default:`);
  lines.push(`        res.setHeader('Allow', [${methods.map(m => `'${m}'`).join(', ')}]);`);
  lines.push(`        return res.status(405).json({ error: \`Method \${method} Not Allowed\` });`);
  lines.push(`    }`);
  lines.push(`  } catch (error) {`);
  lines.push(`    return res.status(500).json({ error: 'Internal Server Error' });`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join('\n');
}

function generateNextJsAppRoute(name: string, methods: string[], withValidation: boolean): string {
  const lines: string[] = [];

  lines.push(`import { NextRequest, NextResponse } from 'next/server';`);
  if (withValidation) {
    lines.push(`import { z } from 'zod';`);
  }
  lines.push('');

  if (withValidation) {
    lines.push(`const ${name}Schema = z.object({`);
    lines.push(`  name: z.string().min(1),`);
    lines.push(`});`);
    lines.push('');
  }

  for (const method of methods) {
    lines.push(`export async function ${method}(request: NextRequest) {`);
    lines.push(`  try {`);

    if (withValidation && ['POST', 'PUT', 'PATCH'].includes(method)) {
      lines.push(`    const body = await request.json();`);
      lines.push(`    const data = ${name}Schema.parse(body);`);
    }

    switch (method) {
      case 'GET':
        lines.push(`    // Fetch ${name}(s)`);
        lines.push(`    return NextResponse.json([]);`);
        break;
      case 'POST':
        lines.push(`    // Create ${name}`);
        lines.push(`    return NextResponse.json({}, { status: 201 });`);
        break;
      case 'PUT':
      case 'PATCH':
        lines.push(`    // Update ${name}`);
        lines.push(`    return NextResponse.json({});`);
        break;
      case 'DELETE':
        lines.push(`    // Delete ${name}`);
        lines.push(`    return new NextResponse(null, { status: 204 });`);
        break;
    }

    lines.push(`  } catch (error) {`);
    lines.push(`    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// 3. CREATE DATABASE MODEL
// ============================================================================

/**
 * Generate database models
 */
export const createModelTool: AgentTool = {
  name: 'create_model',
  description: `Create database models:
- Prisma schemas
- TypeORM entities
- Mongoose models
- Drizzle schemas`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Model name (singular, PascalCase)',
      },
      orm: {
        type: 'string',
        enum: ['prisma', 'typeorm', 'mongoose', 'drizzle'],
        description: 'ORM/ODM to use',
      },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            required: { type: 'boolean' },
            unique: { type: 'boolean' },
            default: { type: 'string' },
          },
        },
        description: 'Model fields',
      },
      directory: {
        type: 'string',
        description: 'Target directory',
      },
    },
    required: ['name', 'orm'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const name = params.name as string;
    const orm = params.orm as string;
    const fields = (params.fields as Array<{
      name: string;
      type: string;
      required?: boolean;
      unique?: boolean;
      default?: string;
    }>) || [
      { name: 'id', type: 'string', required: true, unique: true },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ];
    const directory = params.directory as string;

    try {
      let code: string;
      let filePath: string;

      switch (orm) {
        case 'prisma':
          code = generatePrismaModel(name, fields);
          filePath = path.join(directory || 'prisma', `${name.toLowerCase()}.prisma`);
          break;

        case 'typeorm':
          code = generateTypeORMEntity(name, fields);
          filePath = path.join(directory || 'src/entities', `${name}.ts`);
          break;

        case 'mongoose':
          code = generateMongooseModel(name, fields);
          filePath = path.join(directory || 'src/models', `${name}.ts`);
          break;

        case 'drizzle':
          code = generateDrizzleSchema(name, fields);
          filePath = path.join(directory || 'src/db/schema', `${name.toLowerCase()}.ts`);
          break;

        default:
          return { success: false, error: `Unknown ORM: ${orm}` };
      }

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, code, 'utf-8');

      return {
        success: true,
        data: {
          name,
          orm,
          fields: fields.map(f => f.name),
          file: filePath,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

function generatePrismaModel(
  name: string,
  fields: Array<{ name: string; type: string; required?: boolean; unique?: boolean; default?: string }>
): string {
  const typeMap: Record<string, string> = {
    string: 'String',
    number: 'Int',
    float: 'Float',
    boolean: 'Boolean',
    datetime: 'DateTime',
    json: 'Json',
  };

  const lines: string[] = [];
  lines.push(`model ${name} {`);

  for (const field of fields) {
    const prismaType = typeMap[field.type] || 'String';
    let line = `  ${field.name} ${prismaType}`;

    if (field.name === 'id') {
      line += ' @id @default(cuid())';
    } else {
      if (!field.required) line += '?';
      if (field.unique) line += ' @unique';
      if (field.default) {
        if (field.type === 'datetime' && field.default === 'now') {
          line += ' @default(now())';
        } else {
          line += ` @default(${field.default})`;
        }
      }
    }

    lines.push(line);
  }

  lines.push(`}`);
  return lines.join('\n');
}

function generateTypeORMEntity(
  name: string,
  fields: Array<{ name: string; type: string; required?: boolean; unique?: boolean; default?: string }>
): string {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    float: 'number',
    boolean: 'boolean',
    datetime: 'Date',
    json: 'object',
  };

  const columnTypeMap: Record<string, string> = {
    string: 'varchar',
    number: 'int',
    float: 'float',
    boolean: 'boolean',
    datetime: 'timestamp',
    json: 'json',
  };

  const lines: string[] = [];
  lines.push(`import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';`);
  lines.push('');
  lines.push(`@Entity('${name.toLowerCase()}s')`);
  lines.push(`export class ${name} {`);

  for (const field of fields) {
    if (field.name === 'id') {
      lines.push(`  @PrimaryGeneratedColumn('uuid')`);
      lines.push(`  id: string;`);
    } else if (field.name === 'createdAt') {
      lines.push('');
      lines.push(`  @CreateDateColumn()`);
      lines.push(`  createdAt: Date;`);
    } else if (field.name === 'updatedAt') {
      lines.push('');
      lines.push(`  @UpdateDateColumn()`);
      lines.push(`  updatedAt: Date;`);
    } else {
      const tsType = typeMap[field.type] || 'string';
      const columnType = columnTypeMap[field.type] || 'varchar';

      lines.push('');
      let decorator = `  @Column({ type: '${columnType}'`;
      if (!field.required) decorator += ', nullable: true';
      if (field.unique) decorator += ', unique: true';
      if (field.default) decorator += `, default: ${field.default}`;
      decorator += ' })';

      lines.push(decorator);
      lines.push(`  ${field.name}${!field.required ? '?' : ''}: ${tsType};`);
    }
  }

  lines.push(`}`);
  return lines.join('\n');
}

function generateMongooseModel(
  name: string,
  fields: Array<{ name: string; type: string; required?: boolean; unique?: boolean; default?: string }>
): string {
  const typeMap: Record<string, string> = {
    string: 'String',
    number: 'Number',
    float: 'Number',
    boolean: 'Boolean',
    datetime: 'Date',
    json: 'Schema.Types.Mixed',
  };

  const lines: string[] = [];
  lines.push(`import mongoose, { Schema, Document } from 'mongoose';`);
  lines.push('');
  lines.push(`export interface I${name} extends Document {`);

  for (const field of fields) {
    if (field.name === 'id') continue;
    const tsType = field.type === 'datetime' ? 'Date' : field.type === 'json' ? 'object' : field.type;
    lines.push(`  ${field.name}${!field.required ? '?' : ''}: ${tsType};`);
  }

  lines.push(`}`);
  lines.push('');
  lines.push(`const ${name}Schema = new Schema<I${name}>({`);

  for (const field of fields) {
    if (field.name === 'id') continue;

    const mongoType = typeMap[field.type] || 'String';
    let line = `  ${field.name}: { type: ${mongoType}`;
    if (field.required) line += ', required: true';
    if (field.unique) line += ', unique: true';
    if (field.default) {
      if (field.type === 'datetime' && field.default === 'now') {
        line += ', default: Date.now';
      } else {
        line += `, default: ${field.default}`;
      }
    }
    line += ' },';
    lines.push(line);
  }

  lines.push(`}, { timestamps: true });`);
  lines.push('');
  lines.push(`export const ${name} = mongoose.model<I${name}>('${name}', ${name}Schema);`);

  return lines.join('\n');
}

function generateDrizzleSchema(
  name: string,
  fields: Array<{ name: string; type: string; required?: boolean; unique?: boolean; default?: string }>
): string {
  const typeMap: Record<string, string> = {
    string: 'text',
    number: 'integer',
    float: 'real',
    boolean: 'boolean',
    datetime: 'timestamp',
    json: 'json',
  };

  const lines: string[] = [];
  lines.push(`import { pgTable, text, integer, boolean, timestamp, json, uuid } from 'drizzle-orm/pg-core';`);
  lines.push('');
  lines.push(`export const ${name.toLowerCase()}s = pgTable('${name.toLowerCase()}s', {`);

  for (const field of fields) {
    if (field.name === 'id') {
      lines.push(`  id: uuid('id').primaryKey().defaultRandom(),`);
    } else if (field.name === 'createdAt') {
      lines.push(`  createdAt: timestamp('created_at').defaultNow().notNull(),`);
    } else if (field.name === 'updatedAt') {
      lines.push(`  updatedAt: timestamp('updated_at').defaultNow().notNull(),`);
    } else {
      const drizzleType = typeMap[field.type] || 'text';
      let line = `  ${field.name}: ${drizzleType}('${field.name}')`;
      if (field.required) line += '.notNull()';
      if (field.unique) line += '.unique()';
      if (field.default) line += `.default(${field.default})`;
      line += ',';
      lines.push(line);
    }
  }

  lines.push(`});`);
  lines.push('');
  lines.push(`export type ${name} = typeof ${name.toLowerCase()}s.$inferSelect;`);
  lines.push(`export type New${name} = typeof ${name.toLowerCase()}s.$inferInsert;`);

  return lines.join('\n');
}

// ============================================================================
// 4. CREATE TEST FILE
// ============================================================================

/**
 * Generate test files
 */
export const createTestFileTool: AgentTool = {
  name: 'create_test_file',
  description: `Create test files for existing code:
- Unit tests with Jest/Vitest
- Integration tests
- E2E tests with Playwright
- Test doubles (mocks, stubs)`,
  parameters: {
    type: 'object',
    properties: {
      sourceFile: {
        type: 'string',
        description: 'Path to source file to test',
      },
      testFramework: {
        type: 'string',
        enum: ['jest', 'vitest', 'mocha', 'playwright'],
        description: 'Test framework',
      },
      testType: {
        type: 'string',
        enum: ['unit', 'integration', 'e2e'],
        description: 'Type of test',
      },
    },
    required: ['sourceFile'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const sourceFile = params.sourceFile as string;
    const testFramework = (params.testFramework as string) || 'vitest';
    const testType = (params.testType as string) || 'unit';

    try {
      // Read source file
      const sourceContent = await fs.readFile(sourceFile, 'utf-8');
      const entities = parseEntities(sourceContent);

      // Generate test file path
      const dir = path.dirname(sourceFile);
      const baseName = path.basename(sourceFile, path.extname(sourceFile));
      const testFile = path.join(dir, `${baseName}.test.ts`);

      // Generate test code
      const testCode = generateTestCode(baseName, entities, testFramework, testType);
      await fs.writeFile(testFile, testCode, 'utf-8');

      return {
        success: true,
        data: {
          sourceFile,
          testFile,
          framework: testFramework,
          type: testType,
          functionsToTest: entities.filter(e => e.type === 'function').map(e => e.name),
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

interface TestableEntity {
  type: 'function' | 'class' | 'method' | 'interface' | 'type';
  name: string;
  params: Array<{ name: string; type?: string }>;
  returnType?: string;
  isAsync: boolean;
}

function parseEntities(content: string): TestableEntity[] {
  const entities: TestableEntity[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Exported functions
    const funcMatch = line.match(
      /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\S+))?/
    );
    if (funcMatch) {
      entities.push({
        type: 'function',
        name: funcMatch[1],
        params: parseParamsSimple(funcMatch[2]),
        returnType: funcMatch[3],
        isAsync: line.includes('async'),
      });
    }

    // Exported const functions
    const constFuncMatch = line.match(
      /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/
    );
    if (constFuncMatch) {
      entities.push({
        type: 'function',
        name: constFuncMatch[1],
        params: parseParamsSimple(constFuncMatch[2]),
        returnType: constFuncMatch[3]?.trim(),
        isAsync: line.includes('async'),
      });
    }

    // Exported classes
    const classMatch = line.match(/export\s+class\s+(\w+)/);
    if (classMatch) {
      entities.push({
        type: 'class',
        name: classMatch[1],
        params: [],
        isAsync: false,
      });
    }
  }

  return entities;
}

function parseParamsSimple(paramStr: string): Array<{ name: string; type?: string }> {
  if (!paramStr.trim()) return [];
  return paramStr.split(',').map(p => {
    const [name, type] = p.split(':').map(s => s.trim());
    return { name: name.replace('?', ''), type };
  });
}

function generateTestCode(
  moduleName: string,
  entities: TestableEntity[],
  framework: string,
  testType: string
): string {
  const lines: string[] = [];

  // Imports
  if (framework === 'vitest') {
    lines.push(`import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`);
  } else if (framework === 'jest') {
    lines.push(`import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';`);
  } else if (framework === 'playwright') {
    lines.push(`import { test, expect } from '@playwright/test';`);
  }

  // Import module
  const exports = entities.map(e => e.name).join(', ');
  lines.push(`import { ${exports} } from './${moduleName}';`);
  lines.push('');

  // Generate tests
  for (const entity of entities) {
    if (entity.type === 'function') {
      lines.push(`describe('${entity.name}', () => {`);

      // Setup
      lines.push(`  beforeEach(() => {`);
      lines.push(`    // Setup`);
      lines.push(`  });`);
      lines.push('');

      // Basic test
      lines.push(`  it('should work', ${entity.isAsync ? 'async ' : ''}() => {`);
      const params = entity.params.map(p => generateMockValue(p.type)).join(', ');
      if (entity.isAsync) {
        lines.push(`    const result = await ${entity.name}(${params});`);
      } else {
        lines.push(`    const result = ${entity.name}(${params});`);
      }
      lines.push(`    expect(result).toBeDefined();`);
      lines.push(`  });`);
      lines.push('');

      // Edge cases
      lines.push(`  it('should handle edge cases', ${entity.isAsync ? 'async ' : ''}() => {`);
      lines.push(`    // TODO: Add edge case tests`);
      lines.push(`  });`);
      lines.push('');

      // Error handling
      if (entity.isAsync) {
        lines.push(`  it('should handle errors', async () => {`);
        lines.push(`    // TODO: Test error handling`);
        lines.push(`    await expect(${entity.name}(/* invalid input */)).rejects.toThrow();`);
        lines.push(`  });`);
      }

      lines.push(`});`);
      lines.push('');
    } else if (entity.type === 'class') {
      lines.push(`describe('${entity.name}', () => {`);
      lines.push(`  let instance: ${entity.name};`);
      lines.push('');
      lines.push(`  beforeEach(() => {`);
      lines.push(`    instance = new ${entity.name}();`);
      lines.push(`  });`);
      lines.push('');
      lines.push(`  it('should create instance', () => {`);
      lines.push(`    expect(instance).toBeInstanceOf(${entity.name});`);
      lines.push(`  });`);
      lines.push('');
      lines.push(`  // TODO: Add method tests`);
      lines.push(`});`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateMockValue(type: string | undefined): string {
  if (!type) return 'undefined';
  
  const normalizedType = type.toLowerCase().replace(/\s/g, '');
  
  if (normalizedType.includes('string')) return "'test'";
  if (normalizedType.includes('number')) return '42';
  if (normalizedType.includes('boolean')) return 'true';
  if (normalizedType.includes('array') || normalizedType.includes('[]')) return '[]';
  if (normalizedType.includes('object') || normalizedType.includes('record')) return '{}';
  if (normalizedType.includes('function')) return '() => {}';
  
  return '{}';
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getScaffoldingTools(): AgentTool[] {
  return [
    createComponentTool,
    createApiRouteTool,
    createModelTool,
    createTestFileTool,
  ];
}

export default {
  createComponentTool,
  createApiRouteTool,
  createModelTool,
  createTestFileTool,
  getScaffoldingTools,
};
