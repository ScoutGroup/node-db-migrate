var async = require('async');
var dbmUtil = require('./util');
var Migration = require('./migration');
var log = require('./log');

function isIncludedInUp(migration, destination) {
  if(!destination) {
    return true;
  }
  var migrationTest = migration.name.substring(0, Math.min(migration.name.length, destination.length));
  var destinationTest = destination.substring(0, Math.min(migration.name.length, destination.length));
  return migrationTest <= destinationTest;
}

function filterUp(allMigrations, completedMigrations, destination, count) {
  var sortFn = function(a, b) {
    return a.name.slice(0, a.name.indexOf('-')) - b.name.slice(0, b.name.indexOf('-'));
  };

  return allMigrations.sort(sortFn)
  .filter(function(migration) {
    var hasRun = completedMigrations.some(function(completedMigration) {
      return completedMigration.name === migration.name;
    });
    return !hasRun;
  })
  .filter(function(migration) {
    return isIncludedInUp(migration, destination);
  })
  .slice(0, count);
}

function filterDown(completedMigrations, count) {
  return completedMigrations.slice(0, count);
}


Migrator = function(driver, migrationsDir) {
  this.driver = driver;
  this.migrationsDir = migrationsDir;
};

Migrator.prototype = {
  createMigrationTable: function(callback) {
    this.driver.createMigrationTable(callback);
  },

  writeMigrationRecord: function(migration, callback) {
    function onComplete(err) {
      if (err) {
        log.error(migration.name, err);
      } else {
        log.info('Processed migration', migration.name);
      }
      callback(err);
    }
    this.driver.addMigrationRecord(migration.name, onComplete);
  },

  deleteMigrationRecord: function(migration, callback) {
    function onComplete(err) {
      if (err) {
        log.error(migration.name, err);
      } else {
        log.info('Processed migration', migration.name);
      }
      callback(err);
    }
    this.driver.deleteMigration(global.matching + '/' + migration.name, function(err) {

      if(!global.matching) {

        this.driver.deleteMigration(migration.name, onComplete);
      }
      else {

        onComplete.apply(err);
      }
    }.bind(this));
  },

  up: function(funcOrOpts, callback) {
    if (dbmUtil.isFunction(funcOrOpts)) {
      funcOrOpts(this.driver, callback);
    } else {
      this.upToBy(funcOrOpts.destination, funcOrOpts.count, callback);
    }
  },

  down: function(funcOrOpts, callback) {
    if (dbmUtil.isFunction(funcOrOpts)) {
      funcOrOpts(this.driver, callback);
    } else {
      this.downToBy(funcOrOpts.count, callback);
    }
  },

  upToBy: function(partialName, count, callback) {
    var self = this;
    Migration.loadFromFilesystem(self.migrationsDir, function(err, allFSMigrations) {
      if (err) { callback(err); return; }

      Migration.loadFrom(self.embeddedMigrations || {}, function(err, allEmbeddedMigrations) {
        if (err) { callback(err); return; }

        var allMigrations = allFSMigrations.concat(allEmbeddedMigrations);

        Migration.loadFromDatabase(self.migrationsDir, self.driver, function(err, completedMigrations) {
          if (err) { callback(err); return; }
          var toRun = filterUp(allMigrations, completedMigrations, partialName, count);

          if (toRun.length === 0) {
            log.info('No migrations to run');
            callback(null);
            return;
          }

          async.forEachSeries(toRun, function(migration, next) {
            log.verbose('preparing to run up migration:', migration.name);
            self.driver.startMigration(function() {
              self.up(migration.up.bind(migration), function(err) {
                if (err) { callback(err); return; }
                self.writeMigrationRecord(migration, function() { self.driver.endMigration(next); });
              });
            });
          }, callback);
        });

      });

    });
  },

  downToBy: function(count, callback) {
    var self = this;
    Migration.loadFromDatabase(self.migrationsDir, self.driver, function(err, completedMigrations) {
      if (err) { return callback(err); }

      var toRun = filterDown(completedMigrations, count);

      if (toRun.length === 0) {
        log.info('No migrations to run');
        callback(null);
        return;
      }

      async.forEachSeries(toRun, function(migration, next) {
        log.verbose('preparing to run down migration:', migration.name);
        self.down(migration.down.bind(migration), function(err) {
          if (err) { callback(err); return; }
          self.deleteMigrationRecord(migration, next);
        });
      }, callback);
    });
  }
};

module.exports = Migrator;
