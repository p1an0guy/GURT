FROM python:3.12-slim-bookworm

# Install LibreOffice (Debian repos carry it natively)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice-core \
        libreoffice-impress \
        libreoffice-writer \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Lambda Runtime Interface Client + Python deps
RUN pip install --no-cache-dir awslambdaric boto3 pymupdf

COPY backend /var/task/backend

WORKDIR /var/task

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["backend.ingest_workflow.extract_handler"]
