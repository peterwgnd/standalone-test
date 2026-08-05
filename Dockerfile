FROM python:3.12-slim

WORKDIR /app

# Install Git, curl, and Node.js 22 natively via NodeSource repository
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

# Pull the latest 'src' directly from the public repository
RUN git clone --depth 1 https://github.com/Jigsaw-Code/sensemaking-tools.git /tmp/repo \
    && mv /tmp/repo/src /app/src \
    && rm -rf /tmp/repo \
    && cd /app/src/report_ui && npm install

# Copy the application files
COPY . .

# Default Execution state
WORKDIR /app
ENTRYPOINT ["python", "survey_analytics_orchestrator.py", "-o", "/tmp"]
