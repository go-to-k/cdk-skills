/**
 * AWS CDK 単体テスト 雛形
 *
 * 3 種類のテスト (スナップショット / Fine-grained / バリデーション) を
 * 1 ファイルに収めたサンプル。実プロジェクトでは Stack や責務ごとに
 * test/*.test.ts を分割するのが一般的。
 *
 * 使い方:
 *   1. このファイルを test/my-stack.test.ts にコピー
 *   2. import パスを調整 (../lib/my-stack 等)
 *   3. 不要なセクションは削除
 */

import * as fs from 'fs';
import * as path from 'path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
// import { BUNDLING_STACKS } from 'aws-cdk-lib/cx-api'; // バンドルをスキップしたい場合に使用
import { MyStack } from '../lib/my-stack';

// ============================================================================
// (任意) テスト環境セットアップ ヘルパー
// 詳細は references/setup-tips.md を参照
// ============================================================================

// cdk.json の context (機能フラグ) をテストにも反映させたい場合
const getContext = (): Record<string, any> => {
  const cdkJsonPath = path.join(__dirname, '..', 'cdk.json');
  const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
  return cdkJson.context ?? {};
};

// 上記を使う場合の App 生成例:
//   const app = new App({
//     context: {
//       ...getContext(),
//       [BUNDLING_STACKS]: [], // esbuild バンドルをスキップしたい場合
//     },
//   });

// ============================================================================
// 1. スナップショットテスト (原則必須)
// ============================================================================
describe('Snapshot Tests', () => {
  test('matches snapshot', () => {
    const app = new App();
    const stack = new MyStack(app, 'MyStack');
    const template = Template.fromStack(stack);

    expect(template.toJSON()).toMatchSnapshot();
  });
});

// ============================================================================
// 2. Fine-grained assertions テスト (使い所を選んで書く)
// ============================================================================
describe('Fine-grained assertions tests', () => {
  // --- (a) ループ処理: 生成個数の確認 ---
  test('SNS Topics are created from appNames (deduped)', () => {
    const appNames = ['App1', 'App1', 'App2'];
    const expectedNumberOfTopics = 2; // 重複排除されるので 2

    const app = new App();
    const stack = new MyStack(app, 'MyStack', { appNames });
    const template = Template.fromStack(stack);

    template.resourcePropertiesCountIs(
      'AWS::SNS::Topic',
      { DisplayName: Match.stringLikeRegexp('Topic') },
      expectedNumberOfTopics,
    );
  });

  // --- (b) 条件分岐: リソース生成有無 ---
  test('Web ACL is created in prod', () => {
    const app = new App();
    const stack = new MyStack(app, 'MyStack', { isProd: true });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });

  // --- (b') 条件分岐: プロパティ指定有無 (Match.absent) ---
  test('Web ACL is NOT associated in dev', () => {
    const app = new App();
    const stack = new MyStack(app, 'MyStack', { isProd: false });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        WebACLId: Match.absent(),
      },
    });
  });

  // --- (c) プロパティ override の確認 ---
  test('EventBridge notification is enabled via override', () => {
    const app = new App();
    const stack = new MyStack(app, 'MyStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      NotificationConfiguration: {
        EventBridgeConfiguration: { EventBridgeEnabled: true },
      },
    });
  });

  // --- (d) 特に保証したい定義: 「意思表示」テスト ---
  // 値が変動しても良ければ Match.anyValue() でメンテコストを下げる
  test('LifecycleConfiguration.Expiration must be specified', () => {
    const app = new App();
    const stack = new MyStack(app, 'MyStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          {
            ExpirationInDays: Match.anyValue(),
            Status: 'Enabled',
          },
        ],
      },
    });
  });

  // --- (d') addDependency による依存関係の確認 ---
  test('HostedZone depends on QueryLogResourcePolicy', () => {
    const app = new App();
    const stack = new MyStack(app, 'MyStack', { domainName: 'example.com' });
    const template = Template.fromStack(stack);

    template.hasResource('AWS::Route53::HostedZone', {
      DependsOn: [Match.stringLikeRegexp('QueryLogResourcePolicy')],
    });
  });

  // --- (e-1) props 経由の値の流入確認 ---
  // テストの中で具体値を指定して、その値が CloudFormation テンプレートに
  // 流入していることを確認する基本パターン
  test('messageRetentionPeriod is passed through from props', () => {
    const messageRetentionPeriodInDays = 10;

    const app = new App();
    const stack = new MyStack(app, 'MyStack', { messageRetentionPeriodInDays });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SNS::Topic', {
      ArchivePolicy: { MessageRetentionPeriod: messageRetentionPeriodInDays },
    });
  });

  // --- (e-2) 実 props (本番デプロイ用 config) をそのまま使うパターン (推奨) ---
  // - 実際にデプロイされる構成をテストできる
  // - 具体値の二重管理を避けられる(プロパティ値そのものを参照)
  test('messageRetentionPeriod is passed through from real props', () => {
    // 実プロジェクトでは `import { myStackProps } from '../lib/config';` の想定
    const myStackProps = { messageRetentionPeriodInDays: 30 };

    const app = new App();
    const stack = new MyStack(app, 'MyStack', myStackProps);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SNS::Topic', {
      ArchivePolicy: { MessageRetentionPeriod: myStackProps.messageRetentionPeriodInDays },
    });
  });
});

// ============================================================================
// 3. バリデーションテスト (バリデーション実装時のみ)
// ============================================================================
describe('Validation tests', () => {
  test('lifecycleDays must be <= 400', () => {
    const app = new App();

    expect(() => {
      new MyStack(app, 'MyStack', { lifecycleDays: 500 });
    }).toThrowError('ライフサイクル日数は400日以下にしてください');
  });
});
