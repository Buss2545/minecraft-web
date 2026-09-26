// Backend startup compatibility guard.
// The legacy server.js expects db.loginAttempts during startup. Keep the
// original server.js intact and provide that collection through MongoDB's
// database object before the backend initializes its indexes.
'use strict';

const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const originalDb = MongoClient.prototype.db;

if (!MongoClient.prototype.__mariLoginAttemptsPatch) {
  MongoClient.prototype.db = function patchedDb(...args) {
    const database = originalDb.apply(this, args);
    if (database && typeof database.collection === 'function' && !database.loginAttempts) {
      Object.defineProperty(database, 'loginAttempts', {
        value: database.collection('loginAttempts'),
        enumerable: false,
        configurable: false,
        writable: false
      });
    }
    return database;
  };
  Object.defineProperty(MongoClient.prototype, '__mariLoginAttemptsPatch', { value: true });
}

require('./server.js');
