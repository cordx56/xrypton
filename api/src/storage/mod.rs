use aws_sdk_s3::Client;

use crate::config::AppConfig;

#[derive(Debug, Clone)]
pub struct S3Storage {
    client: Client,
    bucket: String,
}

impl S3Storage {
    pub async fn new(config: &AppConfig) -> Self {
        let mut s3_config = aws_config::defaults(aws_config::BehaviorVersion::latest());
        if let Some(endpoint) = &config.s3_endpoint {
            s3_config = s3_config.endpoint_url(endpoint);
        }
        let sdk_config = s3_config
            .region(aws_config::Region::new(config.s3_region.clone()))
            .load()
            .await;

        let client = Client::new(&sdk_config);
        Self {
            client,
            bucket: config.s3_bucket.clone(),
        }
    }

    pub async fn put_object(
        &self,
        key: &str,
        data: Vec<u8>,
        content_type: &str,
    ) -> Result<(), String> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(data.into())
            .content_type(content_type)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn get_object(&self, key: &str) -> Result<Vec<u8>, String> {
        let resp = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let bytes = resp
            .body
            .collect()
            .await
            .map_err(|e| e.to_string())?
            .into_bytes();
        Ok(bytes.to_vec())
    }

    pub async fn delete_object(&self, key: &str) -> Result<(), String> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
