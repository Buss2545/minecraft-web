import { MongoClient } from 'mongodb';

let clientPromise;

export async function getDatabase(env) {
  const uri = String(env?.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is not configured');

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      maxPoolSize: 5,
      minPoolSize: 0
    });

    clientPromise = client.connect().then(function (connected) {
      return connected;
    }).catch(function (error) {
      // Do not permanently poison the Worker isolate after a transient
      // MongoDB/network/authentication failure. The next request gets a
      // fresh connection attempt.
      clientPromise = undefined;
      try { client.close(); } catch (_) {}
      throw error;
    });
  }

  const client = await clientPromise;
  return client.db('marijpsmp');
}

export function users(db) { return db.collection('users'); }
export function sessions(db) { return db.collection('sessions'); }
export function loginAttempts(db) { return db.collection('loginAttempts'); }
