import { MongoClient } from 'mongodb';

let clientPromise;

export async function getDatabase(env) {
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  if (!clientPromise) {
    const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    clientPromise = client.connect().then(() => client);
  }
  const client = await clientPromise;
  return client.db('marijpsmp');
}

export function users(db) { return db.collection('users'); }
export function sessions(db) { return db.collection('sessions'); }
export function loginAttempts(db) { return db.collection('loginAttempts'); }
