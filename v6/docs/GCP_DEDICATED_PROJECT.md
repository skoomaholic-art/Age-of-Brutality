# Dedicated Google Cloud project for Age of Brutality

The game must not share Poster Editor infrastructure.

The V6 Online deployment expects a separate Google Cloud project and these GitHub repository variables:

- `AOB_GCP_PROJECT_ID`
- `AOB_GCP_REGION`
- `AOB_GCP_WIF_PROVIDER`
- `AOB_GCP_DEPLOY_SA`
- `AOB_GCP_RUNTIME_SA`

## One-time bootstrap

From Google Cloud Shell:

```bash
git clone https://github.com/skoomaholic-art/Age-of-Brutality.git
cd Age-of-Brutality
git checkout feature/v6-persistent-prototype
bash v6/tools/bootstrap-gcp-project.sh
```

Default dedicated project id:

```text
age-of-brutality-skoomaholic
```

Override it before running if needed:

```bash
export AOB_PROJECT_ID="your-unique-project-id"
```

The bootstrap creates only the dedicated project, APIs, service accounts and GitHub Workload Identity Federation. It does not deploy Cloud Run.

After the printed values are configured as GitHub repository variables, run the manual workflow `Deploy Age of Brutality V6 Online to Google Cloud Run`.
