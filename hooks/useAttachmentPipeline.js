export async function runAttachmentPipeline({
  file,
  assetId,
  systemId = null,
  role = null,
  addToTimeline = false,
  metadata = {}
}) {

  const attachment = await uploadAttachment(file)

  if (assetId) {
    await attachToAsset(attachment.id, assetId)
  }

  if (systemId) {
    await attachToSystem(attachment.id, systemId)
  }

  if (addToTimeline) {
    await createTimelineRecord({
      attachmentId: attachment.id,
      ...metadata
    })
  }

  return attachment
}