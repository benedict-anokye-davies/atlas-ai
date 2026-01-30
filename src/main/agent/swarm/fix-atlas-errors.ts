/**
 * @fileoverview Fix Atlas TypeScript Errors - Deploy swarm to fix errors
 * @module agent/swarm/fix-atlas-errors
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * This script deploys the Agent Swarm to fix TypeScript errors in the Atlas codebase.
 * Run with: npx ts-node src/main/agent/swarm/fix-atlas-errors.ts
 */

const { initializeAtlasSwarm } = require('./index');
const { createModuleLogger } = require('../../utils/logger');
const { spawn } = require('child_process');

const logger = createModuleLogger('FixAtlasErrors');

/**
 * Run type check and get error output
 */
async function runTypeCheck(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    logger.info('Running TypeScript type check...');

    const child = spawn('npm', ['run', 'typecheck'], {
      cwd: process.cwd(),
      shell: true,
    });

    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('close', (code: number | null) => {
      resolve({
        success: code === 0,
        output,
      });
    });

    // Timeout after 3 minutes
    setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        output: 'Type check timed out',
      });
    }, 180000);
  });
}

/**
 * Parse TypeScript errors from output
 */
function parseErrors(output: string): Array<{
  file: string;
  line: number;
  column: number;
  message: string;
  code: string;
}> {
  const errors: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    code: string;
  }> = [];

  const lines = output.split('\n');

  for (const line of lines) {
    // Match TypeScript error format: file.ts(line,column): error TSxxxx: message
    const match = line.match(/(.+\.ts)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.+)/);
    if (match) {
      errors.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: match[5],
        message: match[6].trim(),
      });
    }
  }

  return errors;
}

/**
 * Group errors by file
 */
function groupErrorsByFile(
  errors: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    code: string;
  }>
): Map<string, typeof errors> {
  const grouped = new Map<string, typeof errors>();

  for (const error of errors) {
    if (!grouped.has(error.file)) {
      grouped.set(error.file, []);
    }
    grouped.get(error.file)!.push(error);
  }

  return grouped;
}

/**
 * Main function - Deploy swarm to fix errors
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     🤖 Atlas Self-Healing: Deploying Agent Swarm 🤖       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Step 1: Check current TypeScript status
  console.log('📊 Step 1: Analyzing TypeScript errors...\n');
  const typeCheckResult = await runTypeCheck();

  if (typeCheckResult.success) {
    console.log('✅ No TypeScript errors found! Atlas is already perfect.\n');
    return;
  }

  const errors = parseErrors(typeCheckResult.output);
  const groupedErrors = groupErrorsByFile(errors);

  console.log(`❌ Found ${errors.length} TypeScript errors in ${groupedErrors.size} files:\n`);

  // Show error summary
  Array.from(groupedErrors.entries()).forEach(([file, fileErrors]) => {
    console.log(`  📁 ${file}`);
    fileErrors.slice(0, 3).forEach((err) => {
      console.log(`     Line ${err.line}: ${err.message.substring(0, 60)}...`);
    });
    if (fileErrors.length > 3) {
      console.log(`     ... and ${fileErrors.length - 3} more errors`);
    }
    console.log('');
  });

  // Step 2: Initialize the swarm
  console.log('🚀 Step 2: Initializing Agent Swarm...\n');
  const swarm = await initializeAtlasSwarm();

  const status = swarm.getStatus();
  console.log(`✅ Swarm ready with ${status.totalAgents} agents:\n`);
  swarm.getAllAgents().forEach((agent: { name: string; type: string; capabilities: string[] }) => {
    console.log(`   • ${agent.name} (${agent.type}) - ${agent.capabilities.length} capabilities`);
  });
  console.log('');

  // Step 3: Deploy swarm to fix errors
  console.log('🔧 Step 3: Deploying agents to fix errors...\n');

  const results: Array<{ file: string; result: import('./controller').SwarmResult }> = [];

  // Fix errors file by file
  const errorEntries = Array.from(groupedErrors.entries());
  for (let i = 0; i < errorEntries.length; i++) {
    const [file, fileErrors] = errorEntries[i];
    console.log(
      `📝 [${i + 1}/${errorEntries.length}] Fixing ${fileErrors.length} errors in ${file}...`
    );

    const errorDescriptions = fileErrors
      .map((e) => `Line ${e.line}, Column ${e.column}: ${e.message} (${e.code})`)
      .join('\n');

    const result = await swarm.executeTask({
      id: `fix-${file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      description: `Fix TypeScript errors in ${file}:\n${errorDescriptions}`,
      complexity: fileErrors.length > 5 ? 'high' : 'medium',
      type: 'atlas-development',
      requiredCapabilities: ['read-files', 'write-files', 'modify-code', 'type-check'],
    });

    results.push({ file, result });

    if (result.success) {
      console.log(`   ✅ Fixed successfully in ${result.metadata.duration}ms\n`);
    } else {
      console.log(
        `   ❌ Failed to fix: ${result.errors.map((e: Error) => e.message).join(', ')}\n`
      );
    }
  }

  // Step 4: Verify fixes
  console.log('✅ Step 4: Verifying fixes...\n');
  const verificationResult = await runTypeCheck();

  if (verificationResult.success) {
    console.log('🎉 SUCCESS! All TypeScript errors have been fixed!\n');
    console.log('📊 Summary:');
    console.log(`   • Total errors fixed: ${errors.length}`);
    console.log(`   • Files modified: ${groupedErrors.size}`);
    console.log(`   • Agents deployed: ${status.totalAgents}`);
    console.log(
      `   • Total time: ${results.reduce((sum, r) => sum + r.result.metadata.duration, 0)}ms`
    );
    console.log('\n✨ Atlas is now TypeScript error-free!\n');
  } else {
    const remainingErrors = parseErrors(verificationResult.output);
    console.log(`⚠️  Partial success. ${remainingErrors.length} errors remain.\n`);
    console.log('Remaining errors:');
    remainingErrors.forEach((err) => {
      console.log(`   • ${err.file}:${err.line} - ${err.message.substring(0, 50)}...`);
    });
    console.log('\n🔄 You may need to run the fix script again or fix manually.\n');
  }

  // Step 5: Show detailed results
  console.log('📋 Detailed Results:\n');
  results.forEach(({ file, result }) => {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${file}`);
    console.log(`   Duration: ${result.metadata.duration}ms`);
    console.log(`   Agents: ${result.metadata.agentCount}`);
    if (!result.success && result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.map((e) => e.message).join(', ')}`);
    }
    console.log('');
  });
}

// Run the main function
main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
