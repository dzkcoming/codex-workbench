import { Inject, Injectable, NgModule } from '@angular/core';
import { PlatformService } from 'tabby-core';
import { ReferenceActionProvider, type ReferenceSummary } from 'tabby-codex-references';

@Injectable()
export class CopyReferenceSource extends ReferenceActionProvider {
  constructor(@Inject(PlatformService) private platform: PlatformService) { super(); }
  async getActions(reference: ReferenceSummary) {
    return [{ label: '复制来源标识（扩展示例）', click: () => this.platform.setClipboard({ text: JSON.stringify({
      reference_id: reference.id, terminal_id: reference.source.terminal_id,
      session_id: reference.source.session_id, name: reference.source.name,
    }, null, 2) }) }];
  }
}

@NgModule({ providers: [{ provide: ReferenceActionProvider, useClass: CopyReferenceSource, multi: true }] })
export default class ReferenceSourceExampleModule {}
