FROM public.ecr.aws/lambda/python:3.12

RUN dnf install -y libreoffice && dnf clean all
RUN pip install --no-cache-dir boto3 pymupdf

COPY backend ${LAMBDA_TASK_ROOT}/backend

CMD ["backend.ingest_workflow.extract_handler"]
