/**
 * Database migration runner
 * Executes SQL migration files in order
 */
const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabase/client');

// Get migration files from the migrations directory
const getMigrationFiles = () => {
  const migrationsDir = path.join(__dirname, 'migrations');
  return fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => ({
      name: file,
      path: path.join(migrationsDir, file),
      content: fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    }));
};

// Get list of already applied migrations
const getAppliedMigrations = async () => {
  try {
    // Try to query the migrations table directly
    const { data, error } = await supabase
      .from('migrations')
      .select('name');
    
    // If error is table doesn't exist, create it
    if (error && error.code === '42P01') { // Table doesn't exist
      console.log('Migrations table does not exist, creating it...');
      
      // Create the migrations table
      const { error: createError } = await supabase.rpc('execute_sql', {
        sql_string: `
          CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          );
        `
      });
      
      if (createError) {
        console.error('Error creating migrations table:', createError);
        throw createError;
      }
      
      return [];
    } 
    else if (error) {
      console.error('Error checking migrations table:', error);
      throw error;
    }
    
    return data.map(m => m.name);
  } catch (error) {
    console.error('Error in getAppliedMigrations:', error);
    throw error;
  }
};

// Apply migrations
const applyMigrations = async () => {
  const migrations = getMigrationFiles();
  const appliedMigrations = await getAppliedMigrations();
  
  console.log(`Found ${migrations.length} migration files.`);
  console.log(`${appliedMigrations.length} migrations already applied.`);
  
  // Apply pending migrations
  for (const migration of migrations) {
    if (appliedMigrations.includes(migration.name)) {
      console.log(`Migration ${migration.name} already applied.`);
      continue;
    }
    
    console.log(`Applying migration: ${migration.name}`);
    
    try {
      // Execute the migration SQL
      const { error } = await supabase.rpc('execute_sql', {
        sql_string: migration.content
      });
      
      if (error) {
        console.error(`Error applying migration ${migration.name}:`, error);
        throw error;
      }
      
      // Record the migration as applied
      await supabase.from('migrations').insert({
        name: migration.name,
        applied_at: new Date().toISOString()
      });
      
      console.log(`Migration ${migration.name} applied successfully.`);
    } catch (error) {
      console.error(`Failed to apply migration ${migration.name}:`, error);
      process.exit(1);
    }
  }
  
  console.log('All migrations applied successfully.');
};

// Run migrations if this is the main module
if (require.main === module) {
  applyMigrations()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = {
  applyMigrations
};