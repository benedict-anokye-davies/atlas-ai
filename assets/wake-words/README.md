# Custom Wake Word Models

This directory contains custom wake word models (.ppn files) for Nova Desktop.

## Training a Custom "Hey Nova" Wake Word

To create a custom wake word model for "Hey Nova":

### Step 1: Create a Picovoice Account

1. Go to [Picovoice Console](https://console.picovoice.ai/)
2. Sign up for a free account
3. Note your Access Key (also needed in .env as `PORCUPINE_API_KEY`)

### Step 2: Train Your Wake Word

1. Log in to the Picovoice Console
2. Navigate to **Porcupine** section
3. Click **Create New Project**
4. Enter project name: "Nova Desktop"
5. Click **Add Custom Wake Word**
6. Enter the phrase: **"Hey Nova"**
7. Set desired sensitivity (recommended: 0.5-0.7)
8. Click **Train**

Training typically takes a few minutes.

### Step 3: Download the Model

1. Once training completes, click **Download**
2. Select your target platform:
   - **Windows**: Download the Windows model
   - **macOS**: Download the macOS model
   - **Linux**: Download the Linux model
3. Save the `.ppn` file

### Step 4: Install the Model

Option A: Default Location (Recommended)
- Place the file in this directory as: `hey-nova.ppn`
- Nova will automatically detect and use it

Option B: Environment Variable
- Set `NOVA_CUSTOM_WAKE_WORD_PATH` to the full path of your .ppn file
- Example: `NOVA_CUSTOM_WAKE_WORD_PATH=C:\path\to\hey-nova.ppn`

Option C: User Data Directory
- Place the file in: `~/.nova/wake-words/hey-nova.ppn`

### Step 5: Verify Installation

1. Start Nova Desktop
2. Check the logs for: "Using custom wake word model"
3. Say "Hey Nova" to test the wake word

## Troubleshooting

### "Custom wake word model validation failed"
- Ensure the .ppn file was downloaded correctly
- Verify the file is not corrupted (should be > 1KB)
- Check the file has the correct platform (Windows, Mac, or Linux)

### Wake word not detecting
- Increase sensitivity in settings
- Ensure microphone is working
- Check background noise levels
- Try retraining with more samples

### False positive detections
- Decrease sensitivity
- Retrain with more diverse samples
- Add negative samples to the training

## Platform-Specific Notes

### Windows
- Use the Windows-specific .ppn file
- Models trained for other platforms won't work

### macOS
- Download the macOS (Intel or Apple Silicon) model
- Ensure correct architecture for your Mac

### Linux
- Download the Linux x86_64 model
- ARM platforms (Raspberry Pi) need ARM-specific models

## File Naming Convention

The default expected filename is `hey-nova.ppn`. If you have multiple models:

```
hey-nova.ppn           # Primary wake word
hey-nova-windows.ppn   # Windows-specific backup
hey-nova-mac.ppn       # macOS-specific backup
hey-nova-linux.ppn     # Linux-specific backup
```

## Additional Resources

- [Porcupine Documentation](https://picovoice.ai/docs/porcupine/)
- [Wake Word Training Best Practices](https://picovoice.ai/docs/tips/wakeword/)
- [Picovoice Console Help](https://console.picovoice.ai/docs)
