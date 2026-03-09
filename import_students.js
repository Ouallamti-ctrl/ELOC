// ═══════════════════════════════════════════════════════════════════════════════
// ELOC Student Import Script
// Run with: node import_students.js
// Requires: Node.js 18+  (no extra packages needed - uses built-in fetch)
// ═══════════════════════════════════════════════════════════════════════════════

const API = 'https://eloc-backend.onrender.com/api';

// ── Admin credentials (to authenticate the import) ───────────────────────────
const ADMIN_EMAIL    = 'jebrillamti@gmail.com';
const ADMIN_PASSWORD = 'walid123'; // ← replace this

// ── Student dataset from spreadsheet ─────────────────────────────────────────
const RAW_DATA = [
  { name: 'Hanane bensar',      phone: '+212707100101',  fee: 250 },
  { name: 'Rokaia Ben Daoued',  phone: '+212664008800',  fee: 250 },
  { name: 'Samia Alaoui',       phone: '604714639',      fee: 250 },
  { name: 'Anas Jaabouk',       phone: '+212667127856',  fee: 250 },
  { name: 'Hajar El Jazouli',   phone: '+212667127856',  fee: 250 },
  { name: 'Noha Ahrjane',       phone: '+212662897316',  fee: 250 },
  { name: 'Ilyas Harchich',     phone: '+212661685315',  fee: 500 },
  { name: 'Faiza Homsi',        phone: '+212661280116',  fee: 600 },
  { name: 'Amera Rabat',        phone: '+212661515903',  fee: 250 },
  { name: 'Janna Aherjan',      phone: '+212664008800',  fee: 250 },
  { name: 'Zaid eljazouli',     phone: '+212661978314',  fee: 250 },
  { name: 'Basma Toul',         phone: '+212707100101',  fee: 250 },
  { name: 'Marwa Bouaouich',    phone: '+212661449308',  fee: 250 },
  { name: 'Arwa Saidi',         phone: '+212661449308',  fee: 250 },
  { name: 'Yamin Touil',        phone: '+212760688889',  fee: 200 },
  { name: 'Ghita Saidi',        phone: '+212661449308',  fee: 250 },
  { name: 'Hiba Chakir',        phone: '+212707100101',  fee: 250 },
  { name: 'Abir Msteftef',      phone: '+212666853919',  fee: 500 },
  { name: 'Hossin Hamdi',       phone: '+212622414546',  fee: 250 },
  { name: 'Youssef Chakir',     phone: '+212667949550',  fee: 250 },
  { name: 'Khalid louzane',     phone: '+212667949550',  fee: 250 },
  { name: 'Issam Lokman',       phone: '+212707100101',  fee: 400 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function splitName(full) {
  const parts = full.trim().split(/\s+/);
  const first = parts[0];
  const last  = parts.slice(1).join(' ') || parts[0];
  return { first, last };
}

function makeEmail(firstName) {
  return firstName.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]/g, '')                         // remove special chars
    + '@eloc.com';
}

function makePassword(firstName) {
  return firstName.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    + '123';
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-().]/g, '');
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  ELOC Student Import');
  console.log('═'.repeat(60));

  // 1. Login as admin
  console.log('\n🔐 Logging in as admin...');
  let token;
  try {
    const loginRes = await req('POST', '/auth/login', {
      email: ADMIN_EMAIL, password: ADMIN_PASSWORD
    });
    token = loginRes.token;
    console.log('✅ Logged in successfully');
  } catch(e) {
    console.error('❌ Login failed:', e.message);
    console.error('   → Update ADMIN_PASSWORD in this script and retry');
    process.exit(1);
  }

  // 2. Load existing users to check duplicates
  console.log('\n📋 Loading existing users...');
  const existingUsers = await req('GET', '/users', null, token);
  const existingPhones = new Set(
    existingUsers.map(u => normalizePhone(u.phone || ''))
  );
  const existingEmails = new Set(
    existingUsers.map(u => (u.email || '').toLowerCase())
  );
  console.log(`   Found ${existingUsers.length} existing users`);

  // 3. Find teacher Oualid
  const oualid = existingUsers.find(u =>
    u.role === 'teacher' && u.name?.toLowerCase().includes('oualid')
  );
  if (oualid) {
    console.log(`✅ Teacher found: ${oualid.name} (${oualid.id})`);
  } else {
    console.log('⚠️  Teacher "Oualid" not found — students will be created without teacher assignment');
  }

  // 4. Process each student
  const results = {
    created:    [],
    skipped:    [],
    errors:     [],
  };

  const months = [
    { label: 'January 2025',  date: '2025-01-01' },
    { label: 'February 2025', date: '2025-02-01' },
    { label: 'March 2025',    date: '2025-03-01' },
  ];

  console.log(`\n👥 Importing ${RAW_DATA.length} students...\n`);

  for (const row of RAW_DATA) {
    const { first, last } = splitName(row.name);
    const phone    = normalizePhone(row.phone);
    const email    = makeEmail(first);
    const password = makePassword(first);
    const name     = `${first} ${last}`;

    process.stdout.write(`  Processing: ${name.padEnd(25)}`);

    // Duplicate check - phone
    if (existingPhones.has(phone)) {
      console.log(`⏭  SKIPPED (phone ${phone} already exists)`);
      results.skipped.push({ name, reason: `phone ${phone} already registered` });
      continue;
    }

    // Duplicate check - email (handle collisions like hanane@eloc.com taken)
    let finalEmail = email;
    let emailSuffix = 1;
    while (existingEmails.has(finalEmail)) {
      finalEmail = makeEmail(first) .replace('@', `${emailSuffix}@`);
      emailSuffix++;
    }

    try {
      // Create student account
      const student = await req('POST', '/users', {
        name,
        email:            finalEmail,
        password,
        role:             'student',
        phone,
        age:              25,
        city:             'Rabat',
        level:            'B1',
        registrationDate: '2025-01-01',
        paymentStatus:    'paid',
        avatar:           `${first[0]}${last[0] || first[1] || ''}`.toUpperCase(),
      }, token);

      // Mark phone and email as used
      existingPhones.add(phone);
      existingEmails.add(finalEmail);

      // Create 3 paid payment records (Jan, Feb, Mar)
      for (const mo of months) {
        await req('POST', '/payments', {
          studentId: student.id || student._id,
          amount:    row.fee,
          month:     mo.label,
          status:    'paid',
          date:      mo.date,
          method:    'cash',
          note:      'Imported from spreadsheet',
        }, token);
      }

      console.log(`✅ Created  →  ${finalEmail}  /  ${password}`);
      results.created.push({
        name,
        email: finalEmail,
        password,
        phone,
        fee: row.fee,
      });

    } catch(e) {
      console.log(`❌ ERROR: ${e.message}`);
      results.errors.push({ name, error: e.message });
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  // 5. Final report
  console.log('\n' + '═'.repeat(60));
  console.log('  IMPORT COMPLETE — SUMMARY');
  console.log('═'.repeat(60));
  console.log(`\n✅ Created:  ${results.created.length} students`);
  console.log(`⏭  Skipped:  ${results.skipped.length} duplicates`);
  console.log(`❌ Errors:   ${results.errors.length}`);

  if (results.skipped.length > 0) {
    console.log('\n📋 Skipped records:');
    results.skipped.forEach(s => console.log(`   • ${s.name} — ${s.reason}`));
  }

  if (results.errors.length > 0) {
    console.log('\n❌ Errors:');
    results.errors.forEach(s => console.log(`   • ${s.name} — ${s.error}`));
  }

  if (results.created.length > 0) {
    console.log('\n🔑 Student Credentials:');
    console.log('─'.repeat(60));
    results.created.forEach(s => {
      console.log(`  ${s.name.padEnd(22)} ${s.email.padEnd(28)} ${s.password}`);
    });
  }

  console.log('\n✅ Done!\n');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
