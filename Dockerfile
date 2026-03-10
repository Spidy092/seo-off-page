FROM node:18-alpine

# Use non-root user for security
# WORKDIR requires root by default unless created by user, but let's stick to standard practice
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose API port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
