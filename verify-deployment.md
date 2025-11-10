# Deployment Verification Checklist

## 🔍 Your Current Issue

**Error:** `GET /api/companies/my-companies 404 (Not Found)`

**Your Railway URL:** `https://pdf-create-express-production.up.railway.app/`

## ✅ Step-by-Step Debugging

### 1. Check if Server is Running

Visit this URL in your browser:
```
https://pdf-create-express-production.up.railway.app/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "message": "Server is running"
}
```

- ✅ **If you see this:** Server is running, continue to step 2
- ❌ **If you get an error:** Server failed to start, check Railway logs

---

### 2. Check Railway Build Logs

1. Go to Railway dashboard
2. Click on your service
3. Click "Deployments" → Select latest deployment
4. Click "View logs"

**Look for:**
- ✅ `✓ PDF Portal API Server - Express/Node.js`
- ✅ `✓ Server is running on port XXXX`
- ✅ `✓ Database connection has been established successfully`
- ❌ Any error messages about database, missing tables, or connection failures

---

### 3. Run Database Migration

Your database tables might not exist on Railway yet!

**Option A: Using Railway CLI**
```bash
# Install Railway CLI if you haven't
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run migration
railway run node src/config/migrations/001-initial-schema.js

# Verify migration
railway run npm run migrate:verify
```

**Option B: Using Railway Dashboard**
1. Go to your service in Railway
2. Click "Settings" → "Deploy"
3. Add build command: `npm run migrate`
4. Redeploy

**Option C: Add Migration to Start Script**

Update your `package.json`:
```json
"scripts": {
  "start": "node src/config/migrations/001-initial-schema.js && node src/server.js"
}
```

Then redeploy. This ensures tables are created before server starts.

---

### 4. Check Environment Variables

In Railway dashboard, verify these variables are set:

**Required:**
- ✅ `DATABASE_URL` (should be auto-set by PostgreSQL service)
- ✅ `JWT_SECRET_KEY`
- ✅ `OPENAI_API_KEY`
- ✅ `R2_ACCOUNT_ID`
- ✅ `R2_ACCESS_KEY_ID`
- ✅ `R2_SECRET_ACCESS_KEY`
- ✅ `R2_BUCKET`

**Optional but recommended:**
- `NODE_ENV=production`
- `OPENAI_MODEL=gpt-4o`

---

### 5. Check PostgreSQL Service

In Railway dashboard:
1. Make sure PostgreSQL database is running
2. Check that it's in the same project
3. Verify `DATABASE_URL` variable is connected

---

### 6. Check Authentication Token

The `/api/companies/my-companies` endpoint requires:
1. Valid JWT token in Authorization header
2. User must have "Client" role

**Test in browser console:**
```javascript
// Check if you have a token
console.log(localStorage.getItem('token'));

// Check token payload
const token = localStorage.getItem('token');
if (token) {
  const payload = JSON.parse(atob(token.split('.')[1]));
  console.log('User role:', payload.role);
}
```

---

## 🔧 Quick Fix: Recommended Approach

The fastest way to fix this is to ensure migrations run on startup:

### Update package.json
```json
{
  "scripts": {
    "start": "node src/config/migrations/001-initial-schema.js && node src/server.js",
    "start:dev": "node src/server.js"
  }
}
```

This will:
1. Run migration (create tables) on every deployment
2. Then start the server
3. Safe to run multiple times (idempotent)

### Then Redeploy
```bash
git add package.json
git commit -m "Run migrations on startup"
git push origin main
```

Railway will automatically redeploy and migrations will run!

---

## 🚨 Common Issues

### Issue 1: "relation does not exist" error
**Cause:** Tables not created
**Solution:** Run migration (step 3)

### Issue 2: 401 Unauthorized instead of 404
**Cause:** Not logged in or invalid token
**Solution:** Login again in frontend

### Issue 3: 403 Forbidden instead of 404
**Cause:** User doesn't have correct role (not a Client)
**Solution:** Check user role in database

### Issue 4: Server keeps restarting
**Cause:** Database connection failing
**Solution:** Check `DATABASE_URL` and PostgreSQL service

---

## ✅ Final Verification

After fixing, test these endpoints:

1. **Health check:**
   ```
   GET https://pdf-create-express-production.up.railway.app/health
   ```

2. **Login:**
   ```
   POST https://pdf-create-express-production.up.railway.app/api/auth/login
   ```

3. **My Companies:**
   ```
   GET https://pdf-create-express-production.up.railway.app/api/companies/my-companies
   Headers: { "Authorization": "Bearer YOUR_TOKEN" }
   ```

---

## 📊 What Should Happen

When everything is working:
1. Server starts successfully ✅
2. Database connection established ✅
3. All 10 tables created ✅
4. `/health` returns 200 OK ✅
5. `/api/companies/my-companies` returns 200 OK (with valid token) ✅

---

## Need More Help?

Share your Railway logs (from "View Logs") and I can diagnose the exact issue!


