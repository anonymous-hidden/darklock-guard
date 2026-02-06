# 🚀 Deploying DarkLock to Render

This guide will help you deploy the DarkLock Discord Security Bot to Render in just a few minutes.

## Prerequisites

- A GitHub account with this repository
- A Render account (free tier available at https://render.com)
- Discord Bot Token and Application credentials

## Step 1: Prepare Your GitHub Repository

1. **Commit all changes** to your repository:
   ```bash
   git add .
   git commit -m "Prepare for Render deployment"
   git push origin main
   ```

2. **Ensure your repository is up to date** with the latest code

## Step 2: Create a New Web Service on Render

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account (if not already connected)
4. Select your repository
5. Configure the service:
   - **Name**: `darklock-bot` (or your preferred name)
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Root Directory**: Leave blank
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start:render`
   - **Plan**: Free (or paid if needed)

## Step 3: Add Persistent Disk Storage

**IMPORTANT:** Your databases need persistent storage to survive deployments.

1. In your service settings, scroll to **"Disks"**
2. Click **"Add Disk"**
3. Configure:
   - **Name**: `data-disk`
   - **Mount Path**: `/data`
   - **Size**: `1 GB` (free tier)
4. Click **"Save"**

## Step 4: Configure Environment Variables

Go to the **Environment** tab and add these variables:

### Required Discord Configuration
```
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=https://your-app.onrender.com/auth/callback
```

**Get these from:** https://discord.com/developers/applications

### Required Security Keys

Generate JWT_SECRET, ADMIN_JWT_SECRET, and AUDIT_ENCRYPTION_KEY with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Run this command 3 times** to generate 3 different secrets!

Then add:
```
JWT_SECRET=your_generated_jwt_secret
ADMIN_JWT_SECRET=your_generated_admin_jwt_secret_MUST_BE_DIFFERENT
AUDIT_ENCRYPTION_KEY=your_generated_audit_key
ADMIN_PASSWORD=your_secure_admin_password
```

⚠️ **IMPORTANT:** `JWT_SECRET` and `ADMIN_JWT_SECRET` **MUST be different** for security!

### Required Application Settings
```
DASHBOARD_URL=https://your-app.onrender.com
DASHBOARD_PORT=3000
ENABLE_WEB_DASHBOARD=true
NODE_ENV=production
```

**Replace `your-app` with your actual Render service name**

### Required Database Configuration
```
DB_PATH=/data/
DB_NAME=security_bot.db
DARKLOCK_DB_PATH=/data/darklock.db
```

### Optional Settings
```
GUILD_ID=your_test_server_id_for_faster_commands
TAMPER_ALERT_WEBHOOK_URL=your_discord_webhook_url
LOG_LEVEL=info
```

💡 **Tip:** See `.env.render.example` for all variables with descriptions

## Step 5: Update Discord OAuth Redirect URL

1. Go to https://discord.com/developers/applications
2. Select your application
3. Go to **OAuth2** → **General**
4. Add redirect URL: `https://your-app.onrender.com/auth/callback`
5. **Save Changes**

## Step 6: Deploy!

1. Click **"Create Web Service"** or **"Manual Deploy"**
2. Watch the logs as Render builds and starts your bot
3. Wait for the message: `✅ Bot logged in as YourBot#1234`

## Step 7: Verify Deployment

1. **Test the bot** in your Discord server
2. **Access the dashboard** at: `https://your-app.onrender.com`
3. **Check logs** in Render dashboard for any errors

## Post-Deployment

### Auto-Deploy on Git Push
Render automatically redeploys when you push to GitHub. No manual deploys needed!

### Monitoring
- **Logs**: View in real-time from Render dashboard
- **Health Checks**: Render automatically monitors your service
- **Metrics**: CPU, Memory, and Bandwidth usage available

### Scaling
The free tier includes:
- 750 hours/month (enough for one service running 24/7)
- 100 GB bandwidth
- Shared CPU & 512 MB RAM

For production use, consider upgrading to a paid plan for:
- More resources
- Custom domains
- Faster deployments
- Better uptime guarantees

## Troubleshooting

### Bot Not Starting
1. Check environment variables are set correctly
2. Verify DISCORD_TOKEN is valid
3. Check logs for specific errors

### Dashboard Not Accessible
1. Verify `ENABLE_WEB_DASHBOARD=true`
2. Check `DASHBOARD_URL` matches your Render URL
3. Ensure PORT binding is working (Render sets this automatically)

### Database Issues
1. Verify disk is mounted at `/data`
2. Check DB_PATH is set to `/data/`
3. Ensure disk has enough space

### Commands Not Registering
1. Set `GUILD_ID` for faster testing
2. Check bot has proper permissions in Discord
3. Global commands take up to 1 hour to register

## Need Help?

- Check the logs in Render dashboard
- Review the bot logs for specific errors
- Verify all environment variables are correct
- Ensure your Discord bot has the right permissions

## Important Notes

⚠️ **Free Tier Limitations:**
- Service sleeps after 15 minutes of inactivity
- Takes ~30 seconds to wake up on first request
- Consider using a cron job or paid plan for 24/7 uptime

🔐 **Security:**
- Never commit `.env` files with secrets
- Rotate JWT_SECRET and AUDIT_ENCRYPTION_KEY periodically
- Use strong ADMIN_PASSWORD

📦 **Persistence:**
- Only `/data` directory persists between deploys
- Logs and temp files are ephemeral
- Database automatically backed up by disk system

---

**Your DarkLock bot is now live on Render! 🎉**

For updates, just push to GitHub and Render will auto-deploy.
