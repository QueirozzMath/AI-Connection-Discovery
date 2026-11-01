<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Sites and GitHub synchronization

When editing this Site, include a GitHub synchronization step after validation.
- Target repository: QueirozzMath/AI-Connection-Discovery.
- Site appgprj_6ac7c1ef6d608191a2a04a9925b00c85 maps to GitHub branch sites/main.
- Site appgprj_6ac7c36eb9e88191ae59614ebd2abe3b maps to GitHub branch sites/agentes.
- Preserve the GitHub main branch; merge only on the user's explicit instruction.
- Preserve pushed history, credentials, and Site identity. Never commit real API keys.
- Verify file/blob equality and report GitHub synchronization separately from Site publication.
- This is an editing workflow instruction, not a background synchronization service.
