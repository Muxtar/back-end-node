'use strict';

const { ObjectId } = require('mongodb');
const { getDB } = require('../database');

// ─── Constants ────────────────────────────────────────────────────────────────

const CompanyCategories = [
  'Technology',
  'Food & Beverage',
  'Retail',
  'Healthcare',
  'Education',
  'Finance',
  'Real Estate',
  'Transportation',
  'Entertainment',
  'Manufacturing',
  'Construction',
  'Agriculture',
  'Energy',
  'Telecommunications',
  'Tourism',
  'Media',
  'Fashion',
  'Sports',
  'Legal',
  'Other',
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createCompany(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const { name, category, description, website } = req.body || {};

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!category) return res.status(400).json({ error: 'category is required' });
    if (!CompanyCategories.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${CompanyCategories.join(', ')}` });
    }

    const now = new Date();
    const companyDoc = {
      user_id: userId,
      name,
      category,
      description: description || '',
      website: website || null,
      created_at: now,
      updated_at: now,
    };

    const insertResult = await db.collection('companies').insertOne(companyDoc);
    companyDoc._id = insertResult.insertedId;

    return res.status(201).json({ ...companyDoc, id: insertResult.insertedId.toString() });
  } catch (err) {
    console.error('createCompany error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyCompanies(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;

    const companies = await db.collection('companies').find({ user_id: userId })
      .sort({ created_at: -1 })
      .toArray();

    return res.json(companies.map(c => ({ ...c, id: c._id.toString() })));
  } catch (err) {
    console.error('getMyCompanies error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getUserCompanies(req, res) {
  try {
    const db = getDB();
    const targetUserIdStr = req.params.user_id;

    const companies = await db.collection('companies').find({ user_id: targetUserIdStr })
      .sort({ created_at: -1 })
      .toArray();

    return res.json(companies.map(c => ({ ...c, id: c._id.toString() })));
  } catch (err) {
    console.error('getUserCompanies error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateCompany(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const companyIdStr = req.params.company_id;
    const { name, category, description, website } = req.body || {};

    let companyObjId;
    try {
      companyObjId = new ObjectId(companyIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid company ID' });
    }

    const company = await db.collection('companies').findOne({ _id: companyObjId });
    if (!company) return res.status(404).json({ error: 'Company not found' });

    if (company.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: not the owner' });
    }

    if (category && !CompanyCategories.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${CompanyCategories.join(', ')}` });
    }

    const setFields = { updated_at: new Date() };
    if (name !== undefined) setFields.name = name;
    if (category !== undefined) setFields.category = category;
    if (description !== undefined) setFields.description = description;
    if (website !== undefined) setFields.website = website;

    await db.collection('companies').updateOne(
      { _id: companyObjId },
      { $set: setFields }
    );

    const updated = await db.collection('companies').findOne({ _id: companyObjId });
    return res.json({ ...updated, id: updated._id.toString() });
  } catch (err) {
    console.error('updateCompany error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteCompany(req, res) {
  try {
    const db = getDB();
    const userId = req.userId;
    const companyIdStr = req.params.company_id;

    let companyObjId;
    try {
      companyObjId = new ObjectId(companyIdStr);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid company ID' });
    }

    const company = await db.collection('companies').findOne({ _id: companyObjId });
    if (!company) return res.status(404).json({ error: 'Company not found' });

    if (company.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: not the owner' });
    }

    await db.collection('companies').deleteOne({ _id: companyObjId });

    return res.json({ message: 'Company deleted' });
  } catch (err) {
    console.error('deleteCompany error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getCategories(req, res) {
  return res.json({ categories: CompanyCategories });
}

module.exports = {
  createCompany,
  getMyCompanies,
  getUserCompanies,
  updateCompany,
  deleteCompany,
  getCategories,
  CompanyCategories,
};
